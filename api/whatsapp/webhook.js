import { saveMessage, getCandidateIdByPhone, saveCandidate, updateCandidate, getRedisClient, updateMessageStatus, isMessageProcessed } from '../utils/storage.js';
import { processMessage } from '../ai/agent.js';
import { getUltraMsgConfig, getUltraMsgContact, markUltraMsgAsRead } from './utils.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const data = req.body || {};

    // Support Hybrid Event Names (UltraMSG native vs Proxy/Wrapper)
    const eventType = data.event_type || data.event || data.eventName;
    const messageData = data.data || data;

    // 🏎️ FERRARI DEBUG: Always save events for inspection
    try {
        const { saveEvent } = await import('../utils/storage.js');
        await saveEvent(data);
    } catch (e) { }

    if (!eventType) {
        return res.status(200).json({ success: true, message: 'Heartbeat or invalid payload' });
    }

    try {
        // 1. Handle Message Acknowledgments
        if (eventType === 'message_ack' || eventType === 'message.ack') {
            const { id, status, to } = messageData;
            try {
                const phone = to?.replace(/\D/g, '');
                const candidateId = await getCandidateIdByPhone(phone);
                if (candidateId) await updateMessageStatus(candidateId, id, status);
            } catch (ackErr) { /* Silent fail */ }
            return res.status(200).send('ok');
        }

        // 2. Handle Incoming Messages
        if (eventType === 'message_received' || eventType === 'message.incoming') {
            const from = messageData.from || messageData.remoteJid;
            const body = messageData.body || '';
            const msgId = messageData.id;
            const phone = from.replace(/\D/g, '');

            // 🏎️ FERRARI DEDUPLICATION: Atomic Lock (SET NX)
            // This stops retries instantly at the gate.
            if (await isMessageProcessed(msgId)) {
                console.log(`♻️ Ferrari Block: Duplicate message ${msgId} ignored.`);
                return res.status(200).send('duplicate_ignored');
            }

            console.log(`📩 Ferrari Motor: Message from ${phone}`);

            // 🏎️ FERRARI LOOKUP: O(1) Hash Table
            let candidateId = await getCandidateIdByPhone(phone);
            let candidate = null;

            if (candidateId) {
                const { getCandidateById } = await import('../utils/storage.js');
                candidate = await getCandidateById(candidateId);

                if (!candidate) {
                    console.warn(`👻 Ghost Candidate detected in Index: ${candidateId} for ${phone}. Re-creating...`);
                    candidateId = null; // Force re-creation
                }
            }

            if (!candidateId) {
                const newCandidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: messageData.pushname || messageData.pushName || messageData.name || 'Desconocido',
                    origen: 'whatsapp_v2',
                    primerContacto: new Date().toISOString()
                });
                candidateId = newCandidate.id;
            }

            // Sequential ops (Context preservation)
            let agentInput = body;
            const messageType = messageData.type || 'text';

            const msgToSave = {
                from: 'user', content: body, type: messageType,
                timestamp: new Date().toISOString()
            };

            // MULTIMODAL AUDIO SUPPORT 🎙️
            if (messageType === 'ptt' || messageType === 'audio') {
                // UltraMsg sends media URL in 'media' or 'body' depending on version
                const mediaUrl = messageData.media || messageData.body;
                if (mediaUrl && mediaUrl.startsWith('http')) {
                    msgToSave.mediaUrl = mediaUrl;
                    agentInput = { type: 'audio', url: mediaUrl }; // Flag for Agent
                }
            } else if (messageData.media) {
                msgToSave.mediaUrl = messageData.media;
            }

            // Execute storage and AI in parallel where possible, but context needs history.
            // We await history save to ensure the AI sees the current message.
            await saveMessage(candidateId, msgToSave);

            // Background tasks (Non-blocking context)
            const configPromise = getUltraMsgConfig();
            const activityPromise = updateCandidate(candidateId, { ultimoMensaje: new Date().toISOString(), unread: true });

            // 主 AI Session (Wait for it to survive serverless)
            const aiPromise = (async () => {
                try {
                    const redis = getRedisClient();
                    const isActive = await redis?.get('bot_ia_active');
                    if (isActive !== 'false') {
                        await processMessage(candidateId, agentInput);
                    }
                } catch (e) {
                    console.error('🤖 Ferrari AI Error:', e);
                    const redis = getRedisClient();
                    if (redis) await redis.set(`debug:error:webhook_ai:${phone}`, JSON.stringify({ timestamp: new Date().toISOString(), error: e.message }), 'EX', 3600);
                }
            })();

            // Ferrari Background Tasks
            const miscPromise = (async () => {
                try {
                    const config = await configPromise;
                    if (!config) return;
                    await Promise.allSettled([
                        markUltraMsgAsRead(config.instanceId, config.token, from),
                        (async () => {
                            const info = await getUltraMsgContact(config.instanceId, config.token, from);
                            const url = info?.success || info?.image;
                            if (url?.startsWith('http')) await updateCandidate(candidateId, { profilePic: url });
                        })()
                    ]);
                } catch (e) { }
            })();

            // Wait to ensure delivery in serverless environment
            await Promise.allSettled([aiPromise, activityPromise, miscPromise]);

            return res.status(200).send('success');
        }

        return res.status(200).send('ignored');

    } catch (error) {
        console.error('❌ [Webhook] Fatal Error:', error);
        return res.status(200).send('error_handled');
    }
}
