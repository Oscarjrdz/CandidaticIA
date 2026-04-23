/**
 * ═══════════════════════════════════════════════════════════════════
 * 📡 GATEWAY INSTANCE - TERCERA VÍA DE INGRESO
 * ═══════════════════════════════════════════════════════════════════
 * Webhook para instancias Gateway (Baileys/WappGateway).
 * 
 * A diferencia del Catcher (solo captura silenciosa), este webhook:
 * 1. GUARDA los mensajes entrantes (saveMessage) → aparecen en el chat
 * 2. NO ignora candidatos existentes → actualiza timestamps
 * 3. Si candidato tiene bot activo → ejecuta runTurboEngine
 * 4. Si candidato viene de otra vía → MIGRA el origen + msg sistema
 * 
 * Los candidatos entran con bot_ia_active: false por defecto.
 * Si el reclutador lo activa, Brenda responde por Gateway (auto-routing).
 * ═══════════════════════════════════════════════════════════════════
 */
import {
    getCandidateIdByPhone,
    saveCandidate,
    updateCandidate,
    getCandidateById,
    getRedisClient,
    saveMessage,
    addToWaitlist,
    saveWebhookTransaction,
    updateMessageStatus
} from '../utils/storage.js';

const cleanPhoneNumber = (raw = '') => {
    const withoutDevice = String(raw).split('@')[0].split(':')[0];
    return withoutDevice.replace(/\D/g, '');
};

const ensureTagExists = async (tagName = 'GATEWAY') => {
    try {
        const client = getRedisClient();
        if (!client) return;
        const raw = await client.get('candidatic:chat_tags');
        let tags = raw ? JSON.parse(raw) : [];
        tags = tags.map(t => typeof t === 'string' ? { name: t, color: '#3b82f6' } : t);
        if (!tags.find(t => t.name === tagName)) {
            tags.push({ name: tagName, color: '#7c3aed' });
            await client.set('candidatic:chat_tags', JSON.stringify(tags));
        }
    } catch (e) { }
};

const extractMessageContent = (mData, messageData) => {
    const textBody =
        mData.body || mData.text ||
        mData.message?.conversation ||
        mData.message?.extendedTextMessage?.text ||
        messageData.body || messageData.text || '';

    const hasImage = !!(mData.message?.imageMessage || mData.mediaType === 'image');
    const hasAudio = !!(mData.message?.audioMessage || mData.mediaType === 'audio');
    const hasDocument = !!(mData.message?.documentMessage || mData.mediaType === 'document');
    const hasVideo = !!(mData.message?.videoMessage || mData.mediaType === 'video');
    const hasSticker = !!(mData.message?.stickerMessage);

    let type = 'text';
    let content = textBody;

    if (hasImage) { type = 'image'; content = mData.message?.imageMessage?.caption || textBody || '[Imagen]'; }
    else if (hasAudio) { type = 'audio'; content = '[Audio]'; }
    else if (hasDocument) { type = 'document'; content = mData.message?.documentMessage?.fileName || '[Documento]'; }
    else if (hasVideo) { type = 'video'; content = mData.message?.videoMessage?.caption || '[Video]'; }
    else if (hasSticker) { type = 'sticker'; content = '[Sticker]'; }

    return { type, content: content || '[Mensaje]' };
};

// Fire-and-forget: fetch profile pic without blocking the response
const fetchProfilePicAsync = async (phone, candidateId) => {
    try {
        const client = getRedisClient();
        if (!client) return;
        const gwId = await client.get('gateway_instance_id');
        const gwToken = await client.get('gateway_instance_token');
        if (!gwId || !gwToken) return;

        const picRes = await fetch(`https://gatewaywapp-production.up.railway.app/${gwId}/contacts/profile-picture?token=${gwToken}&to=${phone}@c.us`);
        if (picRes.ok) {
            const picData = await picRes.json();
            if (picData.profile_picture?.startsWith('http')) {
                await updateCandidate(candidateId, { profilePic: picData.profile_picture });
            }
        }
    } catch (e) { }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const payload = req.body;
    const client = getRedisClient();

    // Debug: store last payloads (non-blocking)
    if (client) {
        client.lpush('debug:instance_payload_last', JSON.stringify(payload)).catch(() => {});
        client.ltrim('debug:instance_payload_last', 0, 5).catch(() => {});
    }

    const eventType = payload.event_type || payload.event || payload.eventName;
    const messageData = payload.data || payload;

    if (!eventType) {
        return res.status(200).json({ success: true, message: 'Heartbeat' });
    }

    try {
        // ═══ PROCESS INCOMING MESSAGES ═══
        if (eventType === 'message_received' || eventType === 'message.incoming' || eventType === 'messages.upsert') {

            const messagesToProcess = (messageData.messages && Array.isArray(messageData.messages) && messageData.messages.length > 0) 
                ? messageData.messages 
                : [messageData];

            for (let mData of messagesToProcess) {
                const fromRaw = mData.from || mData.remoteJid || mData.key?.remoteJid || '';
                const phone = cleanPhoneNumber(fromRaw);

                if (fromRaw.includes('@g.us') || fromRaw.includes('status@broadcast') || fromRaw.includes('newsletter')) {
                    continue; // Skip broadcast
                }
                if (phone.length < 10 || phone.length > 13) {
                    continue; // Skip invalid
                }
                if (mData.fromMe || mData.from_me || mData.key?.fromMe) {
                    continue; // Skip fromMe
                }

                const pushName = mData.pushname || mData.pushName || mData.name || messageData.pushname || 'Desconocido';
                const msgId = mData.key?.id || mData.id || `gw_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                const { type: msgType, content: msgContent } = extractMessageContent(mData, mData);

                // Quick profile pic check from payload only (no HTTP blocking)
                const profilePicOptions = [
                    payload?.sender?.profilePictureUrl, payload?.sender?.profilePicUrl, payload?.sender?.picture,
                    payload?.data?.sender?.profilePictureUrl, payload?.data?.sender?.profilePicUrl,
                    messageData?.sender?.profilePictureUrl, messageData?.sender?.profilePicUrl,
                    mData?.sender?.profilePictureUrl, mData?.sender?.profilePicUrl,
                    messageData?.profilePictureUrl, mData?.profilePictureUrl
                ];
                const profilePicUrl = profilePicOptions.find(p => typeof p === 'string' && p.startsWith('http')) || null;

                // ═══ LOOKUP OR CREATE CANDIDATE ═══
                let candidateId = await getCandidateIdByPhone(phone);
                let candidate = candidateId ? await getCandidateById(candidateId) : null;

                const msgToSave = {
                    id: msgId,
                    from: 'user',
                    content: msgContent,
                    type: msgType,
                    timestamp: new Date().toISOString()
                };

                if (candidate) {
                    // ═══ EXISTING CANDIDATE ═══
                    const wasGateway = candidate.origen === 'gateway_instance';

                    if (!wasGateway) {
                        // ═══ MIGRATION: Switch origin to gateway_instance ═══
                        candidate.origen = 'gateway_instance';
                        candidate.bot_ia_active = false;

                        // Insert system message marking the channel change
                        await saveMessage(candidateId, {
                            id: `sys_${Date.now()}`,
                            from: 'system',
                            content: '📡 Canal actualizado — este candidato ahora se comunica por Gateway',
                            type: 'system',
                            timestamp: new Date().toISOString()
                        });

                        console.log(`[GATEWAY INSTANCE] 🔄 MIGRATED ${phone} to gateway_instance`);
                    }

                    // ═══ ATOMIC PIPELINE: Save message + update candidate + SSE in 1 Redis roundtrip ═══
                    const updatedCandidate = {
                        ...candidate,
                        ultimoMensaje: new Date().toISOString(),
                        lastUserMessageAt: new Date().toISOString(),
                        unreadMsgCount: (Number(candidate.unreadMsgCount) || 0) + 1,
                        ...(profilePicUrl && !candidate.profilePic ? { profilePic: profilePicUrl } : {})
                    };

                    await saveWebhookTransaction({
                        candidateId,
                        message: msgToSave,
                        candidateUpdates: updatedCandidate,
                        eventData: null,
                        statsType: 'incoming'
                    });

                    // Force instant SSE stat recalculation
                    if (client) client.del('stats:bot:last_calc').catch(() => {});

                    // Fire-and-forget: fetch photo if missing (doesn't block response)
                    if (!candidate.profilePic && !profilePicUrl) {
                        fetchProfilePicAsync(phone, candidateId);
                    }

                    // If bot is active for this candidate, trigger AI
                    if (candidate.bot_ia_active === true && wasGateway) {
                        try {
                            await addToWaitlist(candidateId, { text: msgContent, msgId });
                            const { runTurboEngine } = await import('../workers/process-message.js');
                            await runTurboEngine(candidateId, phone);
                        } catch (botErr) {
                            console.error(`[GATEWAY INSTANCE] Bot error:`, botErr.message);
                        }
                    }

                } else {
                    // ═══ NEW CANDIDATE ═══
                    ensureTagExists('GATEWAY');

                    const now = Date.now();
                    const newCandidate = await saveCandidate({
                        whatsapp: phone,
                        nombre: pushName,
                        origen: 'gateway_instance',
                        profilePic: profilePicUrl,
                        status: 'Capturado',
                        tags: ['GATEWAY'],
                        esNuevo: 'NO',
                        bot_ia_active: false,
                        primerContacto: new Date(now - 2000).toISOString(), // 2s before to bypass isEmptyChat (blue ring)
                        ultimoMensaje: new Date(now).toISOString(),
                        unreadMsgCount: 1
                    });

                    candidateId = newCandidate?.id || await getCandidateIdByPhone(phone);

                    // Save first message via atomic pipeline
                    if (candidateId) {
                        const freshCandidate = await getCandidateById(candidateId);
                        await saveWebhookTransaction({
                            candidateId,
                            message: msgToSave,
                            candidateUpdates: freshCandidate,
                            eventData: null,
                            statsType: 'incoming'
                        });
                    }

                    // Fire-and-forget: fetch photo if not in payload
                    if (!profilePicUrl && candidateId) {
                        fetchProfilePicAsync(phone, candidateId);
                    }

                    console.log(`[GATEWAY INSTANCE] 📡 NEW: ${phone} - ${pushName}`);
                }
            }
            return res.status(200).send('message_processed');
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
                        notifyCandidateUpdate(candidateId, { 
                            messageStatusUpdate: { id: msgId, status: statusStr } 
                        }).catch(() => {});
                    } catch (e) {}
                }
            }
            return res.status(200).send('ack_processed');
        } else if (eventType === 'presence_update') {
            // ═══ HANDLE PRESENCE UPDATES ═══
            const raw = payload.__raw || {};
            const candidatePhone = cleanPhoneNumber(raw.id || payload.id || '');
            if (candidatePhone && candidatePhone.length >= 10) {
                const candidateId = await getCandidateIdByPhone(candidatePhone);
                if (candidateId) {
                    const presences = payload.presences || raw.presences || {};
                    const presenceData = Object.values(presences)[0];
                    if (presenceData && presenceData.lastKnownPresence) {
                        try {
                            const { notifyCandidateUpdate } = await import('../utils/sse-notify.js');
                            const isTyping = presenceData.lastKnownPresence === 'composing' || presenceData.lastKnownPresence === 'recording';
                            // Emit false when they stop typing, or their name/true when they start
                            notifyCandidateUpdate(candidateId, { 
                                candidateTyping: isTyping ? true : false
                            }).catch(() => {});
                        } catch (e) {}
                    }
                }
            }
            return res.status(200).send('presence_processed');
        }

        // ═══ ACK EVENTS ═══
        if (eventType === 'message_ack' || eventType === 'messages.update') {
            return res.status(200).send('ack_noted');
        }

        return res.status(200).send('ok_ignored');

    } catch (e) {
        console.error('❌ [Gateway Instance] Error:', e);
        return res.status(500).send('internal_error');
    }
}
