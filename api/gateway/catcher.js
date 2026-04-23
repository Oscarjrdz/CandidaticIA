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
    getRedisClient,
    saveMessage,
    updateMessageStatus
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

            const messagesToProcess = (messageData.messages && Array.isArray(messageData.messages) && messageData.messages.length > 0) 
                ? messageData.messages 
                : [messageData];

            for (let mData of messagesToProcess) {

            const fromRaw = mData.from || mData.remoteJid || mData.key?.remoteJid || '';
            const phone = cleanPhoneNumber(fromRaw);

            // Bloquear mensajes de grupos o estados
            if (fromRaw.includes('@g.us') || fromRaw.includes('status@broadcast') || fromRaw.includes('newsletter')) {
                continue;
            }

            // Ignorar basura, números cortos o falsos
            if (phone.length < 10 || phone.length > 13) {
                continue;
            }

            // Ignorar mensajes enviados por nosotros mismos (Sync)
            if (messageData.fromMe || messageData.from_me || mData.key?.fromMe || mData.fromMe) {
                continue;
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
            // --- Photo fetch moved to fire-and-forget AFTER candidate is saved ---

            // --- 2. BUSCAR O CREAR AL CANDIDATO EN LA BASE ---
            let candidateId = await getCandidateIdByPhone(phone);
            
            if (candidateId) {
                // Check if this is a gateway_instance candidate touching the Catcher
                const existingCandidate = await getCandidateById(candidateId);
                if (existingCandidate?.origen === 'gateway_instance') {
                    // Notify recruiter without changing origin
                    await saveMessage(candidateId, {
                        id: `sys_${Date.now()}`,
                        from: 'system',
                        content: '📲 Este candidato contactó al Catcher. Respóndele por Gateway.',
                        type: 'system',
                        timestamp: new Date().toISOString()
                    });
                    await updateCandidate(candidateId, {
                        ultimoMensaje: new Date().toISOString(),
                        unreadMsgCount: (existingCandidate.unreadMsgCount || 0) + 1
                    });
                    // SSE notify
                    try {
                        const { notifyCandidateUpdate } = await import('../utils/sse-notify.js');
                        notifyCandidateUpdate(candidateId, { ultimoMensaje: new Date().toISOString(), newMessage: true }).catch(() => {});
                    } catch (e) {}
                    console.log(`[GATEWAY CATCHER] 📡 Gateway candidate ${phone} contacted Catcher. Alert injected.`);
                }
                // Si ya existe en base, NO se hace nada más
                continue;
                
            } else {
                // Es un Lead NUEVO. Lo guardamos en la base general pero silencioso
                const newCandidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: pushName,
                    origen: 'Captura Externa',
                    instanceId: capturedInstanceId,
                    profilePic: profilePicUrl,
                    status: 'Capturado',
                    tags: [tagToAssign],
                    esNuevo: 'NO',
                    bot_ia_active: false,
                    primerContacto: new Date().toISOString(),
                    ultimoMensaje: new Date().toISOString(),
                    mensajesTotales: 0
                });

                // 🚀 SSE: Notify dashboard IMMEDIATELY
                try {
                    const { notifyNewCandidate } = await import('../utils/sse-notify.js');
                    notifyNewCandidate(newCandidate).catch(() => {});
                } catch (e) {}

                // 📸 Fire-and-forget: fetch photo WITHOUT blocking the response
                if (!profilePicUrl) {
                    const candId = newCandidate?.id;
                    (async () => {
                        try {
                            const catcherInstanceId = (client ? await client.get('catcher_instance_id') : null) || 'a2c8cea97a';
                            const catcherToken = (client ? await client.get('catcher_instance_token') : null) || '0ef8455a4a5a45e099df7cd6851a24d2';
                            const picRes = await fetch(`https://gatewaywapp-production.up.railway.app/${catcherInstanceId}/contacts/profile-picture?token=${catcherToken}&to=${phone}@c.us`);
                            if (picRes.ok) {
                                const picData = await picRes.json();
                                if (picData.profile_picture?.startsWith('http') && candId) {
                                    await updateCandidate(candId, { profilePic: picData.profile_picture });
                                }
                            }
                        } catch (e) {}
                    })();
                }
                
                console.log(`[GATEWAY CATCHER] 🎣 LEAD CAPTURADO: ${phone} - ${pushName}`);
            }

            // ⚠️ IMPORTANTE: RETORNAMOS 200 AQUI MIMSO.
            // NO agregamos el mensaje al waitlist, NO llamamos a runTurboEngine(),
            // NO invocamos a procesarlo con Brenda IA.
            continue;
            }
            return res.status(200).send('lead_captured_silently');
        } else if (eventType === 'message_ack' || eventType === 'message.ack') {
            // ═══ HANDLE MESSAGE STATUS ACKS ═══
            const msgId = messageData.id;
            const statusStr = messageData.status; // sent, delivered, read
            
            // Extract the recipient phone from the raw update data
            const raw = messageData.__raw || {};
            const rawKey = raw.key || {};
            const fromRaw = rawKey.remoteJid || rawKey.participant || '';
            const recipientPhone = cleanPhoneNumber(fromRaw);

            if (msgId && statusStr && recipientPhone.length >= 10) {
                const candidateId = await getCandidateIdByPhone(recipientPhone);
                if (candidateId) {
                    await updateMessageStatus(candidateId, msgId, statusStr);
                    try {
                        const { notifyCandidateUpdate } = await import('../utils/sse-notify.js');
                        notifyCandidateUpdate(candidateId, { status_update: true }).catch(() => {});
                    } catch (e) {}
                }
            }
            return res.status(200).send('ack_processed');
        }

        // --- 3. MANEJAR OTRAS COSAS CÓMO EVENTOS DE ERROR O ACKS ---
        return res.status(200).send('ok_ignored');

    } catch (e) {
        console.error('❌ [Gateway Catcher] Error:', e);
        return res.status(500).send('internal_error');
    }
}
