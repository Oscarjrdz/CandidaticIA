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

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const payload = req.body;
    
    // Identificar tipo de evento para EvolutionAPI o estándar
    const eventType = payload.event_type || payload.event || payload.eventName;
    const messageData = payload.data || payload; 

    // Solo procesar si hay un evento
    if (!eventType) {
        return res.status(200).json({ success: true, message: 'Heartbeat o payload inválido' });
    }

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
            const profilePicOptions = [
                payload.profilePictureUrl,
                payload.picture,
                messageData.profilePictureUrl,
                messageData.picture,
                mData.profilePictureUrl,
                mData.picture
            ];
            const profilePicUrl = profilePicOptions.find(p => p && p.startsWith('http')) || null;

            // Instancia que lo capturó
            const capturedInstanceId = messageData.instanceId || payload.instanceId || payload.instance?.instanceId || req.headers['x-instance-id'] || 'gateway_catcher';

            // --- 2. BUSCAR O CREAR AL CANDIDATO EN LA BASE ---
            let candidateId = await getCandidateIdByPhone(phone);
            
            if (candidateId) {
                // Si ya existe, solo actualizamos su foto si viene una nueva, o marcamos que se contactó
                let updatePayload = {
                    ultimoMensaje: new Date().toISOString()
                };
                
                // Si recibimos una url de foto nueva y válida
                if (profilePicUrl) {
                    updatePayload.profilePic = profilePicUrl;
                }

                await updateCandidate(candidateId, updatePayload);
                console.log(`[GATEWAY CATCHER] Candidato actualizado: ${phone}`);
                
            } else {
                // Es un Lead NUEVO. Lo guardamos en la base general pero silencioso
                const newCandidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: pushName,
                    origen: 'Captura Externa', // Para distinguirlo en métricas
                    instanceId: capturedInstanceId,
                    profilePic: profilePicUrl,
                    status: 'Capturado', // Estatus especial para saber que es una base pasiva
                    esNuevo: 'NO', // Evita que si más adelante se altera reciba mensaje de bienvenida automáticamente
                    bot_ia_active: false, // BLOQUEO HARD: Brenda IA no debe procesarlo nunca
                    primerContacto: new Date().toISOString(),
                    ultimoMensaje: new Date().toISOString()
                });
                
                console.log(`[GATEWAY CATCHER] 🎣 LEAD CAPTURADO NUEVO: ${phone} - ${pushName}`);
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
