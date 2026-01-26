import { saveMessage, getCandidateIdByPhone, saveCandidate, updateCandidate, getRedisClient, updateMessageStatus, isMessageProcessed } from '../utils/storage.js';
import { processMessage } from '../ai/agent.js';
import { getUltraMsgConfig, getUltraMsgContact, markUltraMsgAsRead } from './utils.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const data = req.body;
    if (!data || !data.event_type) {
        return res.status(200).json({ success: true, message: 'Heartbeat or invalid payload' });
    }

    const eventType = data.event_type;
    const messageData = data.data;

    try {
        // 1. Handle Message Acknowledgments (Lifecycle Tracking)
        if (eventType === 'message_ack') {
            const { id, status, to } = messageData;
            try {
                const phone = to?.replace(/\D/g, '');
                const candidateId = await getCandidateIdByPhone(phone);
                if (candidateId) await updateMessageStatus(candidateId, id, status);
            } catch (ackErr) { /* Silent fail */ }
            return res.status(200).send('ok');
        }

        // 2. Handle Incoming Messages
        if (eventType === 'message_received') {
            const from = messageData.from;
            const body = messageData.body || '';
            const pushName = messageData.pushname;
            const msgId = messageData.id;
            const phone = from.replace(/\D/g, '');

            // DEDUPLICATION: Prevent duplicate processing (Retries)
            const alreadyDone = await isMessageProcessed(msgId);
            if (alreadyDone) {
                console.log(`♻️ Skipping duplicate message ${msgId} from ${phone}`);
                return res.status(200).send('duplicate_ignored');
            }

            console.log(`📩 [Webhook] Message from ${phone} (${pushName})`);

            // Find or Create Candidate (FAST)
            let candidateId = await getCandidateIdByPhone(phone);
            if (!candidateId) {
                const newCandidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: pushName || 'Desconocido',
                    origen: 'whatsapp_v2',
                    primerContacto: new Date().toISOString()
                });
                candidateId = newCandidate.id;
            }

            // Save Message to History
            const msgToSave = {
                from: 'user',
                content: body,
                type: messageData.type || 'text',
                timestamp: new Date().toISOString()
            };
            if (messageData.media) msgToSave.mediaUrl = messageData.media;
            await saveMessage(candidateId, msgToSave);

            // Update candidate activity
            await updateCandidate(candidateId, {
                ultimoMensaje: new Date().toISOString(),
                unread: true
            });

            // Trigger AI and background tasks without blocking
            const config = await getUltraMsgConfig();

            // AI Session (Non-blocking)
            const aiPromise = (async () => {
                try {
                    const redis = getRedisClient();
                    const isActive = await redis?.get('bot_ia_active');
                    if (isActive !== 'false') {
                        await processMessage(candidateId, body);
                    }
                } catch (e) {
                    console.error('🤖 AI Error:', e);
                    const redis = getRedisClient();
                    if (redis) {
                        await redis.set(`debug:error:webhook_ai:${phone}`, JSON.stringify({
                            timestamp: new Date().toISOString(),
                            error: e.message
                        }), 'EX', 3600);
                    }
                }
            })();

            // Background Helpers (Non-blocking)
            const miscPromise = (async () => {
                if (!config) return;
                try {
                    await Promise.allSettled([
                        markUltraMsgAsRead(config.instanceId, config.token, from),
                        (async () => {
                            try {
                                const info = await getUltraMsgContact(config.instanceId, config.token, from);
                                const url = info?.success || info?.image;
                                if (url?.startsWith('http')) await updateCandidate(candidateId, { profilePic: url });
                            } catch (e) { }
                        })()
                    ]);
                } catch (e) { }
            })();

            // AWAIT results to prevent serverless termination
            await Promise.allSettled([aiPromise, miscPromise]);

            return res.status(200).send('success');
        }

        return res.status(200).send('ignored');

    } catch (error) {
        console.error('❌ [Webhook] Fatal Error:', error);
        return res.status(200).send('error_handled');
    }
}
