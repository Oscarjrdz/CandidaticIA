import { saveMessage, getCandidateIdByPhone, saveCandidate, updateCandidate, getRedisClient, updateMessageStatus, isMessageProcessed, unlockMessage } from '../utils/storage.js';
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
        const { saveEvent, incrementMessageStats } = await import('../utils/storage.js');
        await saveEvent(data);
        if (eventType === 'message_received' || eventType === 'message.incoming') {
            incrementMessageStats('incoming');
        }
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
                return res.status(200).send('duplicate_ignored');
            }


            try {
                // --- SYSTEM & ADMIN COMMAND FILTER ---
                const adminNumber = '5218116038195';
                if (phone === adminNumber) {
                    const lowerBody = body.toLowerCase().trim();
                    // Command: simon[phone] -> Approve User
                    if (lowerBody.startsWith('simon')) {
                        const targetPhone = lowerBody.replace('simon', '').replace(/\D/g, '');
                        if (targetPhone) {
                            try {
                                const { getUsers, saveUser } = await import('../utils/storage.js');
                                const { sendMessage } = await import('../utils/messenger.js');
                                const users = await getUsers();
                                const userIndex = users.findIndex(u => u.whatsapp.includes(targetPhone));

                                if (userIndex !== -1) {
                                    const user = users[userIndex];
                                    user.status = 'Active';
                                    await saveUser(user);

                                    // Notify Admin
                                    await sendMessage(adminNumber, `✅ Usuario ${user.name} (${targetPhone}) activado con éxito.`);

                                    // Notify User
                                    await sendMessage(user.whatsapp, `🎉 ¡Felicidades ${user.name}! Tu cuenta ha sido activada. Ya puedes iniciar sesión en Candidatic IA. 🚀`);

                                    return res.status(200).send('user_activated');
                                } else {
                                    await sendMessage(adminNumber, `❌ No encontré ningún usuario pendiente con el número ${targetPhone}.`);
                                    return res.status(200).send('user_not_found');
                                }
                            } catch (err) {
                                console.error('Error activating user:', err);
                                return res.status(200).send('activation_error');
                            }
                        }
                    }
                    // If it's the admin but not a command, we ALLOW it to fall through 
                    // so the admin can test the Bot.
                }

                // --- AUTH MESSAGE FILTER (PINs & Flows) ---
                if (/^\d{4}$/.test(body.trim())) {
                    return res.status(200).send('pin_ignored');
                }

                // Also ignore messages from users who are in Pending status (Recruiters signing up)
                try {
                    const { getUsers } = await import('../utils/storage.js');
                    const allUsers = await getUsers();
                    const isPending = allUsers.find(u => u.whatsapp.includes(phone) && u.status === 'Pending');
                    if (isPending) {
                        return res.status(200).send('pending_user_ignored');
                    }
                } catch (e) { }

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

                // 🏎️ [IMMEDIATE PRESENCE] - Mark as read and start typing ASAP
                const presenceUpdate = (async () => {
                    const config = await getUltraMsgConfig();
                    if (config) {
                        const { sendUltraMsgPresence } = await import('./utils.js');
                        const results = await Promise.allSettled([
                            markUltraMsgAsRead(config.instanceId, config.token, from),
                            sendUltraMsgPresence(config.instanceId, config.token, from, 'composing')
                        ]);
                        // Log results for debugging
                        results.forEach((res, idx) => {
                            if (res.status === 'rejected') {
                                console.error(`❌ Webhook immediate action ${idx === 0 ? 'READ' : 'PRESENCE'} failed:`, res.reason);
                            }
                        });
                    }
                })();

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
                const activityPromise = updateCandidate(candidateId, {
                    ultimoMensaje: new Date().toISOString(),
                    lastUserMessageAt: new Date().toISOString(),
                    unread: true
                });

                // 主 AI Session (Wait for it to survive serverless)
                const aiPromise = (async () => {
                    try {
                        const redis = getRedisClient();

                        // 1. ALWAYS TRIGGER EXTRACTION (Titanium Capture)
                        const extractionTask = (async () => {
                            try {
                                const { getMessages } = await import('../utils/storage.js');
                                const { intelligentExtract } = await import('../utils/intelligent-extractor.js');
                                const freshMessages = await getMessages(candidateId);
                                const historyText = freshMessages
                                    .filter(m => m.from === 'user' || m.from === 'bot' || m.from === 'me')
                                    .slice(-15)
                                    .map(m => {
                                        const sender = (m.from === 'user') ? 'Candidato' : 'Reclutador';
                                        let content = m.content || '';
                                        if (m.type === 'audio' || m.type === 'ptt') content = '((Mensaje de Audio))';
                                        return `${sender}: ${content}`;
                                    })
                                    .join('\n');
                                await intelligentExtract(candidateId, historyText);
                            } catch (extErr) {
                                console.error('⚠️ [Webhook] Extraction Task Error:', extErr);
                            }
                        })();

                        // 2. TRIGGER BOT IF ACTIVE
                        const isActive = await redis?.get('bot_ia_active');
                        if (isActive !== 'false') {
                            await processMessage(candidateId, agentInput);
                        }

                        await extractionTask; // Ensure extraction finishes
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
                            (async () => {
                                const info = await getUltraMsgContact(config.instanceId, config.token, from);
                                const url = info?.success || info?.image;
                                if (url?.startsWith('http')) await updateCandidate(candidateId, { profilePic: url });
                            })()
                        ]);
                    } catch (e) { }
                })();

                // Wait to ensure delivery in serverless environment
                await Promise.allSettled([aiPromise, activityPromise, miscPromise, presenceUpdate]);

                return res.status(200).send('success');

            } catch (err) {
                console.error(`⚠️ Error processing message ${msgId}, releasing lock.`);
                await unlockMessage(msgId);
                throw err;
            }
        }

        return res.status(200).send('ignored');

    } catch (error) {
        console.error('❌ [Webhook] Fatal Error:', error);
        return res.status(200).send('error_handled');
    }
}
