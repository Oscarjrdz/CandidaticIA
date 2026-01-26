import { saveMessage, getCandidateIdByPhone, saveCandidate, updateCandidate, getRedisClient, updateMessageStatus } from '../utils/storage.js';
import { processMessage } from '../ai/agent.js';
import { getUltraMsgConfig, getUltraMsgContact, markUltraMsgAsRead } from './utils.js';

// Helper for timeouts
const timeout = (ms) => new Promise(resolve => setTimeout(() => resolve('TIMEOUT'), ms));

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

    console.log(`📨 [Webhook] Event: ${eventType} | From/To: ${messageData?.from || messageData?.to} | Type: ${messageData?.type || 'N/A'}`);

    try {
        // 1. Handle Message Acknowledgments (Lifecycle Tracking)
        if (eventType === 'message_ack') {
            const { id, status, to } = messageData;
            console.log(`📡 [Webhook] Message ACK: ${id} -> ${status} for ${to}`);

            try {
                const phone = to.replace(/\D/g, '');
                const candidateId = await getCandidateIdByPhone(phone);

                if (candidateId) {
                    await updateMessageStatus(candidateId, id, status);
                    console.log(`✅ [Webhook] Updated status for ${id} to ${status}`);
                }
            } catch (ackErr) {
                console.error('❌ [Webhook] Error processing ACK:', ackErr.message);
            }
            return res.status(200).send('ok');
        }

        // 2. Handle Incoming Messages
        if (eventType === 'message_received') {
            const from = messageData.from; // e.g. "5218112345678@c.us"
            const body = messageData.body;
            const pushName = messageData.pushname;
            const phone = from.replace(/\D/g, '');

            console.log(`📩 [Webhook] PROCESSING Message from ${phone} (${pushName})`);

            // Find or Create Candidate
            let candidateId = await getCandidateIdByPhone(phone);
            if (!candidateId) {
                console.log(`✨ New candidate detected: ${phone}`);
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
                content: body || '',
                type: messageData.type || 'text',
                timestamp: new Date().toISOString()
            };

            if (messageData.media || ['image', 'video', 'audio', 'voice', 'ptt', 'document'].includes(messageData.type)) {
                msgToSave.mediaUrl = messageData.media;
            }

            await saveMessage(candidateId, msgToSave);

            // Update candidate last activity
            await updateCandidate(candidateId, {
                ultimoMensaje: new Date().toISOString(),
                unread: true
            });

            // Trigger parallel background tasks
            const config = await getUltraMsgConfig();

            // Mark as Read (Async)
            const readReceiptPromise = config ? (async () => {
                await timeout(1000);
                return markUltraMsgAsRead(config.instanceId, config.token, from);
            })() : Promise.resolve();

            // Fetch Profile Pic (Async, cache for 2s)
            const profilePicPromise = config ? Promise.race([
                (async () => {
                    try {
                        const contactInfo = await getUltraMsgContact(config.instanceId, config.token, from);
                        const url = contactInfo?.success || contactInfo?.image;
                        if (url && typeof url === 'string' && url.startsWith('http')) {
                            await updateCandidate(candidateId, { profilePic: url });
                        }
                    } catch (e) { }
                })(),
                timeout(2000)
            ]) : Promise.resolve();

            // AI Integration (Async)
            const aiPromise = (async () => {
                try {
                    const redis = getRedisClient();
                    const isActive = await redis?.get('bot_ia_active');

                    if (redis) {
                        await redis.set(`debug:webhook:${phone}`, JSON.stringify({
                            timestamp: new Date().toISOString(),
                            event: 'ai_triggered',
                            body: body || '(empty)'
                        }), 'EX', 3600);
                    }

                    if (isActive !== 'false') {
                        const result = await processMessage(candidateId, body || '');
                        console.log(`🤖 AI Processed for ${phone}:`, result.substring(0, 50));
                    }
                } catch (e) {
                    console.error('🤖 AI Error:', e);
                    const redis = getRedisClient();
                    if (redis) {
                        await redis.set(`debug:webhook:${phone}:error`, JSON.stringify({
                            timestamp: new Date().toISOString(),
                            error: e.message
                        }), 'EX', 3600);
                    }
                }
            })();

            // Don't block the webhook response too long
            Promise.allSettled([readReceiptPromise, profilePicPromise, aiPromise])
                .then(() => console.log(`🏁 [Webhook] Finished background tasks for ${phone}`));

            return res.status(200).send('success');
        }

        console.log(`⚠️ [Webhook] Ignored event type: ${eventType}`);
        return res.status(200).send('ignored');

    } catch (error) {
        console.error('❌ [Webhook] Fatal Error:', error);
        return res.status(200).send('error_handled');
    }
}
