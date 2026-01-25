import { saveMessage, getCandidateIdByPhone, saveCandidate, updateCandidate, getRedisClient } from '../utils/storage.js';
import { processMessage } from '../ai/agent.js';
import { getUltraMsgConfig, getUltraMsgContact, markUltraMsgAsRead } from './utils.js';

export default async function handler(req, res) {
    if (req.method === 'POST') {
        const data = req.body; // UltraMsg payload

        console.log('📨 Webhook headers:', JSON.stringify(req.headers));
        console.log('📨 Webhook payload:', JSON.stringify(data).substring(0, 200));

        // Basic Validation
        if (!data || !data.data) {
            console.log('⚠️ Ignored: No data or invalid payload');
            return res.status(200).send('ok');
        }

        const messageData = data.data;
        const eventType = data.event_type;

        console.log(`TYPE: ${eventType}, FROM: ${messageData.from}, BODY: ${messageData.body}`);

        // 1. Handle Message Acknowledgments (Lifecycle Tracking)
        if (eventType === 'message_ack') {
            const { id, status, to } = messageData;
            console.log(`📡 [Webhook] Message ACK: ${id} -> ${status} for ${to}`);

            try {
                const phone = to.replace(/\D/g, '');
                const candidateId = await getCandidateIdByPhone(phone);

                if (candidateId) {
                    const messages = await getMessages(candidateId);
                    // Find the message by its ultraMsgId and update its status
                    const msgIndex = messages.findIndex(m => m.ultraMsgId === id);
                    if (msgIndex !== -1) {
                        messages[msgIndex].status = status;
                        // Replace the entire message list (Redis rpush doesn't support easy per-index update)
                        const client = getRedisClient();
                        if (client) {
                            const key = `messages:${candidateId}`;
                            await client.del(key);
                            for (const msg of messages) {
                                await client.rpush(key, JSON.stringify(msg));
                            }
                        }
                    }
                }
            } catch (ackErr) {
                console.error('Error processing ACK:', ackErr.message);
            }
            return res.status(200).send('ok');
        }

        // Only process incoming messages (already handled ack above)
        if (eventType !== 'message_received') {
            console.log('⚠️ Ignored event type:', eventType);
            return res.status(200).send('ok');
        }

        try {
            const from = messageData.from; // e.g. "5218112345678@c.us"
            const body = messageData.body;
            const pushName = messageData.pushname;

            // Clean phone number (remove @c.us and non-digits)
            const phone = from.replace(/\D/g, '');

            console.log(`📩 [Webhook] PROCESSING Message from ${phone} (${pushName})`);

            // 1. Find or Create Candidate
            let candidateId = await getCandidateIdByPhone(phone);
            console.log(`🔍 Candidate ID found: ${candidateId}`);

            if (!candidateId) {
                console.log(`✨ New candidate detected: ${phone}`);
                const newCandidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: pushName || 'Desconocido',
                    origen: 'whatsapp_v2',
                    primerContacto: new Date().toISOString()
                });
                candidateId = newCandidate.id;
                console.log(`✨ Created Candidate ID: ${candidateId}`);
            }

            // --- READ RECEIPT (Instant) ---
            const config = await getUltraMsgConfig();
            let readReceiptPromise = Promise.resolve();
            if (config) {
                // Add a small delay (1s) to make it look "read" by someone 
                readReceiptPromise = (async () => {
                    await timeout(1000);
                    return markUltraMsgAsRead(config.instanceId, config.token, from);
                })();
            }

            // 2. Save Message to History
            const msgToSave = {
                from: 'user',
                content: body || '',
                type: messageData.type || 'text',
                timestamp: new Date().toISOString()
            };

            // Capture media if present (Include ptt and document)
            if (messageData.media || ['image', 'video', 'audio', 'voice', 'ptt', 'document'].includes(messageData.type)) {
                msgToSave.mediaUrl = messageData.media;
            }

            const msgResult = await saveMessage(candidateId, msgToSave);
            console.log('💾 Message Saved Result:', msgResult);

            // Update candidate last activity
            await updateCandidate(candidateId, {
                ultimoMensaje: new Date().toISOString(),
                unread: true
            });
            console.log('⏱️ Updated Candidate Timestamp');

            // PARALLEL EXECUTION with TIMEOUTS
            // reliableTimeout helper
            const timeout = (ms) => new Promise(resolve => setTimeout(() => resolve('TIMEOUT'), ms));

            // Profile Pic: Strict 2s timeout. If it's slow, skip it.
            const profilePicTask = (async () => {
                try {
                    const config = await getUltraMsgConfig();
                    if (config) {
                        const contactInfo = await getUltraMsgContact(config.instanceId, config.token, from);
                        // UltraMsg 'contacts/image' returns { "success": "url..." } 
                        const url = contactInfo?.success || contactInfo?.image;

                        if (url && typeof url === 'string' && url.startsWith('http')) {
                            await updateCandidate(candidateId, { profilePic: url });
                            console.log('📸 Profile Pic Updated:', url);
                        }
                    }
                } catch (pErr) {
                    console.warn('Profile Pic Fetch Error', pErr.message);
                }
            })();

            const profilePicPromise = Promise.race([
                profilePicTask,
                timeout(2000)
            ]);

            // AI Process: Critical, but catch errors
            const aiProcessPromise = (async () => {
                try {
                    const redis = getRedisClient();
                    let isActive = 'false';
                    if (redis) {
                        isActive = await redis.get('bot_ia_active');
                    } else {
                        console.warn('⚠️ [Webhook] Redis client not available for AI check, skipping.');
                    }
                    console.log(`🤖 AI Status Check: ${isActive}`);

                    if (isActive !== 'false') {
                        console.log('🚀 Triggering AI Process...');
                        await processMessage(candidateId, body);
                        console.log('🤖 AI Process Completed');
                    } else {
                        console.log('💤 Bot Internal AI is paused.');
                    }
                } catch (aiErr) {
                    console.error('Failed to trigger AI:', aiErr);
                }
            })();

            // Wait for AI and Read Receipt to finish
            await Promise.allSettled([profilePicPromise, aiProcessPromise, readReceiptPromise]);

            return res.status(200).send('success');

        } catch (error) {
            console.error('❌ Webhook Error:', error);
            // Return 200 anyway to prevent webhook retries loop
            return res.status(200).send('error_handled');
        }
    }

    return res.status(200).send('ok');
}
