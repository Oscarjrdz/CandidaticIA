/**
 * ═══════════════════════════════════════════════════════════════════
 * 🎣 GATEWAY CATCHER - CAPTURA DE LEADS (SILENCIOSO)
 * ═══════════════════════════════════════════════════════════════════
 * Este webhook es exclusivamente para instancias Baileys/EvolutionAPI/WappGateway.
 * 
 * Propósito:
 * Recibir mensajes entrantes, capturar la foto (profileUrl), nombre (pushName),
 * y número del usuario, y guardarlos en la base de datos como Candidatos
 * con status "Capturado" para su envío masivo posterior (Meta Bulks).
 * 
 * ⚠️ NO INICIA LA INTELIGENCIA ARTIFICIAL (Brenda). Es 100% silencioso.
 * ═══════════════════════════════════════════════════════════════════
 */
import {
    getCandidateIdByPhone,
    saveCandidate,
    updateCandidate,
    getCandidateById,
    getRedisClient
} from '../utils/storage.js';

// Elimina caracteres no numéricos del número de teléfono y remueve sufijos
const cleanPhoneNumber = (raw = '') => {
    const withoutDevice = String(raw).split('@')[0].split(':')[0];
    return withoutDevice.replace(/\D/g, '');
};

// Automáticamente asegura que la etiqueta original o la dinámica exista en la configuración
const ensureCatcherTagExists = async (tagToEnsure = 'CATCHER') => {
    try {
        const client = getRedisClient();
        if (!client) return;
        const raw = await client.get('candidatic:chat_tags');
        let tags = raw ? JSON.parse(raw) : [
            {name: 'Urgente', color: '#64748b'}, {name: 'Entrevista', color: '#f97316'},
            {name: 'Contratado', color: '#eab308'}, {name: 'Rechazado', color: '#22c55e'},
            {name: 'Duda', color: '#3b82f6'}
        ];
        
        tags = tags.map(t => typeof t === 'string' ? {name: t, color: '#3b82f6'} : t);
        
        if (!tags.find(t => t.name === tagToEnsure)) {
            tags.push({name: tagToEnsure, color: '#8b5cf6'}); // Color morado/púrpura default para tags dinámicos
            await client.set('candidatic:chat_tags', JSON.stringify(tags));
            console.log(`[GATEWAY CATCHER] 🏷️ Etiqueta global ${tagToEnsure} asegurada en base de datos.`);
        }
    } catch (e) {
        console.error('Error asegurando la etiqueta:', e);
    }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const payload = req.body;
    const { getRedisClient } = await import('../utils/storage.js');
    const client = getRedisClient();
    
    // Identificar etiqueta dinámica
    let tagToAssign = 'CATCHER';
    try {
        if (client) {
            const customTag = await client.get('catcher_tag');
            if (customTag) tagToAssign = customTag;
        }
    } catch(e) {}
    
    // Asegurar fondo etiqueta globalmente sin bloquear respuesta
    ensureCatcherTagExists(tagToAssign);
    
    // Identificar tipo de evento para EvolutionAPI o estándar
    const eventType = payload.event_type || payload.event || payload.eventName;
    const messageData = payload.data || payload; 

    // Solo procesar si hay un evento
    if (!eventType) {
        return res.status(200).json({ success: true, message: 'Heartbeat o payload inválido' });
    }

    try {
        const payloadStr = JSON.stringify(payload);
        const { getRedisClient } = await import('../utils/storage.js');
        const client = getRedisClient();
        if (client) {
            await client.lpush('debug:catcher_payload_last', payloadStr);
            await client.ltrim('debug:catcher_payload_last', 0, 5); // Guardar los ultimos 5
        }
    } catch(e) {}

    try {
        // --- 1. PROCESAR MENSAJES ENTRANTES (CAPTURAR LEADS) ---
        if (eventType === 'message_received' || eventType === 'message.incoming' || eventType === 'messages.upsert') {
            
            let mData = messageData;
            // Si viene en array (EvolutionAPI messages.upsert)
            if (messageData.messages && Array.isArray(messageData.messages) && messageData.messages.length > 0) {
                mData = messageData.messages[0];
            }

            const fromRaw = mData.from || mData.remoteJid || mData.key?.remoteJid || '';
            const phone = cleanPhoneNumber(fromRaw);

            // Bloquear mensajes de grupos o estados
            if (fromRaw.includes('@g.us') || fromRaw.includes('status@broadcast') || fromRaw.includes('newsletter')) {
                return res.status(200).send('broadcast_ignored');
            }

            // Ignorar basura, números cortos o falsos
            if (phone.length < 10 || phone.length > 13) {
                return res.status(200).send('invalid_number_ignored');
            }

            // Ignorar mensajes enviados por nosotros mismos (Sync)
            if (messageData.fromMe || messageData.from_me || mData.key?.fromMe || mData.fromMe) {
                return res.status(200).send('from_me_ignored');
            }

            // Extraer nombre y foto
            const pushName = messageData.pushname || messageData.pushName || messageData.name || mData.pushName || 'Desconocido';
            
            // La foto suele venir en ciertos payloads de EvolutionAPI o podemos forzar un update ligero
            // NOTA: En EvolutionAPI la URL de perfil a veces viene en 'profilePictureUrl' o 'picture'
            // Y está anidado en el obj de 'sender' (en webhooks messages.upsert)
            const profilePicOptions = [
                payload?.sender?.profilePictureUrl,
                payload?.sender?.profilePicUrl,
                payload?.sender?.picture,
                payload?.data?.sender?.profilePictureUrl,
                payload?.data?.sender?.profilePicUrl,
                payload?.data?.sender?.picture,
                payload?.profilePictureUrl,
                payload?.picture,
                messageData?.sender?.profilePictureUrl,
                messageData?.sender?.profilePicUrl,
                messageData?.sender?.picture,
                messageData?.profilePictureUrl,
                messageData?.picture,
                mData?.sender?.profilePictureUrl,
                mData?.sender?.profilePicUrl,
                mData?.sender?.picture,
                mData?.profilePictureUrl,
                mData?.picture
            ];
            
            // Clean up missing/undefined array entries before finding
            const validOptions = profilePicOptions.filter(p => typeof p === 'string' && p.trim() !== '');
            let profilePicUrl = validOptions.find(p => p.startsWith('http')) || null;

            // Instancia que lo capturó
            const capturedInstanceId = messageData.instanceId || payload.instanceId || payload.instance?.instanceId || req.headers['x-instance-id'] || 'gateway_catcher';

            // --- Novedad: Rescate manual de la foto usando el Gateway API directo ---
            if (!profilePicUrl) {
                try {
                    console.log(`[GATEWAY CATCHER] Foto no venía en webhook. Extrayendo manualmente para: ${phone}...`);
                    const fetchUrl = `https://gatewaywapp-production.up.railway.app/a2c8cea97a/contacts/profile-picture?token=0ef8455a4a5a45e099df7cd6851a24d2&to=${phone}@c.us`;
                    
                    const resPic = await fetch(fetchUrl);
                    if (resPic.ok) {
                        const jsonPic = await resPic.json();
                        if (jsonPic.profile_picture && jsonPic.profile_picture.startsWith('http')) {
                            profilePicUrl = jsonPic.profile_picture;
                            console.log(`[GATEWAY CATCHER] 📸 Foto descargada con éxito: ${profilePicUrl.substring(0, 45)}...`);
                        } else {
                            console.log(`[GATEWAY CATCHER] No se encontró foto en API para: ${phone}`);
                        }
                    }
                } catch (err) {
                    console.error('[GATEWAY CATCHER] Error obteniendo foto manual:', err.message);
                }
            }

            // --- 2. BUSCAR O CREAR AL CANDIDATO EN LA BASE ---
            let candidateId = await getCandidateIdByPhone(phone);
            
            if (candidateId) {
                // Si ya existe en base, NO se hace nada, tal como se solicitó para aplicar solo a nuevos.
                console.log(`[GATEWAY CATCHER] Ignorado - Candidato ya existe: ${phone}`);
                return res.status(200).send('existing_lead_ignored');
                
            } else {
                // Es un Lead NUEVO. Lo guardamos en la base general pero silencioso
                const newCandidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: pushName,
                    origen: 'Captura Externa', // Para distinguirlo en métricas
                    instanceId: capturedInstanceId,
                    profilePic: profilePicUrl,
                    status: 'Capturado', // Estatus especial para saber que es una base pasiva
                    tags: [tagToAssign], // Agregar la etiqueta dinámica actual configurada
                    esNuevo: 'NO', // Evita que si más adelante se altera reciba mensaje de bienvenida automáticamente
                    bot_ia_active: false, // BLOQUEO HARD: Brenda IA no debe procesarlo nunca
                    primerContacto: new Date().toISOString(),
                    ultimoMensaje: new Date().toISOString()
                });
                
                console.log(`[GATEWAY CATCHER] 🎣 LEAD CAPTURADO NUEVO CATCHER: ${phone} - ${pushName}`);
            }

            // ⚠️ IMPORTANTE: RETORNAMOS 200 AQUI MIMSO.
            // NO agregamos el mensaje al waitlist, NO llamamos a runTurboEngine(),
            // NO invocamos a procesarlo con Brenda IA.
            return res.status(200).send('lead_captured_silently');
        }

        // --- 3. MANEJAR OTRAS COSAS CÓMO EVENTOS DE ERROR O ACKS ---
        return res.status(200).send('ok_ignored');

    } catch (e) {
        console.error('❌ [Gateway Catcher] Error:', e);
        return res.status(500).send('internal_error');
    }
}
