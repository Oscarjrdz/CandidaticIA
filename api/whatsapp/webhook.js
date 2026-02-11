import {
    saveMessage,
    getCandidateIdByPhone,
    saveCandidate,
    updateCandidate,
    getRedisClient,
    updateMessageStatus,
    isMessageProcessed,
    unlockMessage,
    isCandidateLocked,
    unlockCandidate,
    addToWaitlist,
    getWaitlist,
    getCandidateById,
    getUsers,
    saveUser,
    saveWebhookTransaction,
    markMessageAsDone
} from '../utils/storage.js';
import { processMessage } from '../ai/agent.js';
import { getUltraMsgConfig, getUltraMsgContact, markUltraMsgAsRead, sendUltraMsgPresence } from './utils.js';
import { FEATURES } from '../utils/feature-flags.js';
import { sendMessage } from '../utils/messenger.js';
import { notifyNewCandidate } from '../utils/sse-notify.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const data = req.body || {};
    const eventType = data.event_type || data.event || data.eventName;
    const messageData = data.data || data;

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

            // 🏎️ DEDUPLICATION: Atomic Lock (Two-Phase Commit)
            if (await isMessageProcessed(msgId)) {
                return res.status(200).send('duplicate_ignored');
            }

            // IGNORE OUTGOING MESSAGES
            if (messageData.fromMe || messageData.from_me) {
                return res.status(200).send('from_me_ignored');
            }

            try {
                // --- ADMIN COMMANDS ---
                const adminNumber = '5218116038195';
                if (phone === adminNumber) {
                    const lowerBody = body.toLowerCase().trim();
                    if (lowerBody.startsWith('simon')) {
                        const targetPhone = lowerBody.replace('simon', '').replace(/\D/g, '');
                        if (targetPhone) {
                            try {
                                const users = await getUsers();
                                const userIndex = users.findIndex(u => u.whatsapp.includes(targetPhone));
                                if (userIndex !== -1) {
                                    const user = users[userIndex];
                                    user.status = 'Active';
                                    await saveUser(user);
                                    await sendMessage(adminNumber, `✅ Usuario ${user.name} (${targetPhone}) activado con éxito.`);
                                    await sendMessage(user.whatsapp, `🎉 ¡Felicidades ${user.name}! Tu cuenta ha sido activada. Ya puedes iniciar sesión en Candidatic IA. 🚀`);
                                    return res.status(200).send('user_activated');
                                } else {
                                    await sendMessage(adminNumber, `❌ No encontré ningún usuario pendiente con el número ${targetPhone}.`);
                                    return res.status(200).send('user_not_found');
                                }
                            } catch (err) {
                                console.error('Error activating user:', err);
                            }
                        }
                    }
                }

                // --- GATEKEEPERS ---
                const bodyTrim = body.trim();
                const isAuthAttempt = /^\d{4}$/.test(bodyTrim);
                if (isAuthAttempt && !bodyTrim.startsWith('19') && !bodyTrim.startsWith('20')) {
                    return res.status(200).send('pin_ignored');
                }

                try {
                    const allUsers = await getUsers();
                    const isPending = allUsers.find(u => u.whatsapp.includes(phone) && u.status === 'Pending');
                    if (isPending && phone !== '8116038195') return res.status(200).send('pending_user_ignored');
                } catch (e) { }

                // --- CANDIDATE LOOKUP ---
                let candidateId = await getCandidateIdByPhone(phone);
                let candidate = null;

                if (candidateId) {
                    candidate = await getCandidateById(candidateId);
                    if (!candidate) candidateId = null;
                }

                if (!candidateId) {
                    candidate = await saveCandidate({
                        whatsapp: phone,
                        nombre: messageData.pushname || messageData.pushName || messageData.name || 'Desconocido',
                        origen: 'whatsapp_v2',
                        primerContacto: new Date().toISOString()
                    });
                    candidateId = candidate.id;
                    notifyNewCandidate(candidate).catch(() => { });
                }

                console.log(`[WEBHOOK] Incoming message from ${phone}: ${body.substring(0, 30)}...`);

                // --- ADMIN STICKER ---
                const messageType = messageData.type || 'text';
                if (phone === adminNumber && (messageType === 'sticker' || messageType === 'stickerMessage')) {
                    const stickerUrl = messageData.media || messageData.body || messageData.file;
                    if (stickerUrl?.startsWith('http')) {
                        const redis = getRedisClient();
                        await redis.set('bot_celebration_sticker', stickerUrl);
                        await sendMessage(adminNumber, `✅ ¡Sticker de festejo guardado!✨🎉`);
                        return res.status(200).send('sticker_captured');
                    }
                }

                let agentInput = body;
                const msgToSave = {
                    id: msgId,
                    from: 'user', content: body, type: messageType,
                    timestamp: new Date().toISOString()
                };

                if (messageType === 'ptt' || messageType === 'audio') {
                    const mediaUrl = messageData.media || messageData.body;
                    if (mediaUrl?.startsWith('http')) {
                        msgToSave.mediaUrl = mediaUrl;
                        agentInput = { type: 'audio', url: mediaUrl };
                    }
                } else if (messageData.media) {
                    msgToSave.mediaUrl = messageData.media;
                }

                // --- PERSISTENCE ---
                const updatedCandidate = {
                    ...candidate,
                    ultimoMensaje: new Date().toISOString(),
                    lastUserMessageAt: new Date().toISOString(),
                    unread: true
                };

                const configPromise = getUltraMsgConfig();

                await saveWebhookTransaction({
                    candidateId,
                    message: msgToSave,
                    candidateUpdates: updatedCandidate,
                    eventData: data,
                    statsType: 'incoming'
                });

                // --- PRESENCE ---
                const presenceUpdate = (async () => {
                    const config = await configPromise;
                    if (config) {
                        try {
                            await markUltraMsgAsRead(config.instanceId, config.token, from);
                            await sendUltraMsgPresence(config.instanceId, config.token, from, 'composing');
                        } catch (e) { }
                    }
                })();

                // --- AI PROCESSING (Industrial Waitlist) ---
                const aiPromise = (async () => {
                    try {
                        const redis = getRedisClient();
                        const isActive = await redis?.get('bot_ia_active');
                        if (isActive === 'false' || candidate?.blocked === true) return;

                        // 🏁 1. ADD TO WAITLIST
                        await addToWaitlist(candidateId, { text: agentInput, msgId });

                        // 🏁 2. WORKER LOCK
                        const isLocked = await isCandidateLocked(candidateId);
                        if (isLocked) {
                            console.log(`[Industrial Queue] Candidate ${candidateId} is busy. Queued.`);
                            return;
                        }

                        try {
                            // 🏁 3. DRAIN LOOP
                            let loopSafety = 0;
                            while (loopSafety < 10) {
                                const rawPendingMsgs = await getWaitlist(candidateId);
                                if (!rawPendingMsgs || rawPendingMsgs.length === 0) break;

                                const pendingMsgs = rawPendingMsgs.map(m => {
                                    try { return typeof m === 'string' ? JSON.parse(m) : m; }
                                    catch (e) { return { text: m }; }
                                });

                                const aggregatedText = pendingMsgs.map(m => m.text?.url || m.text || m).join(' | ');
                                const msgIds = pendingMsgs.map(m => m.msgId).filter(id => id);
                                if (msgId && !msgIds.includes(msgId)) msgIds.push(msgId);

                                console.log(`[Industrial Queue] Processing burst for ${candidateId}. Count: ${pendingMsgs.length}`);

                                let processingError = null;
                                try {
                                    if (FEATURES.USE_MESSAGE_QUEUE) {
                                        const protocol = req.headers['x-forwarded-proto'] || 'https';
                                        const host = req.headers.host;
                                        const workerUrl = `${protocol}://${host}/api/workers/process-message`;

                                        const workerRes = await fetch(workerUrl, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ candidateId, message: aggregatedText, messageId: msgId, from: phone })
                                        });
                                        if (!workerRes.ok) throw new Error('Worker HTTP fail');
                                    } else {
                                        await processMessage(candidateId, aggregatedText, msgId);
                                    }
                                } catch (e) {
                                    processingError = e;
                                    console.error('❌ AI Processing Failed:', e.message);
                                }

                                // 🏁 4. DEDUPLICATION COMMIT
                                if (!processingError) {
                                    await Promise.all(msgIds.map(id => markMessageAsDone(id).catch(() => { })));
                                } else {
                                    await Promise.all(msgIds.map(id => unlockMessage(id).catch(() => { })));
                                    throw processingError;
                                }

                                loopSafety++;
                                const more = await getWaitlist(candidateId);
                                if (!more || more.length === 0) break;
                            }
                        } finally {
                            await unlockCandidate(candidateId);
                        }
                    } catch (error) {
                        console.error('❌ AI Pipeline Error:', error);
                    }
                })();

                const miscPromise = (async () => {
                    try {
                        const config = await configPromise;
                        if (!config) return;
                        const info = await getUltraMsgContact(config.instanceId, config.token, from);
                        const url = info?.success || info?.image;
                        if (url?.startsWith('http')) {
                            await updateCandidate(candidateId, { profilePic: url });
                        }
                    } catch (e) { }
                })();

                await Promise.allSettled([aiPromise, miscPromise, presenceUpdate]);
                return res.status(200).send('success');

            } catch (err) {
                console.error(`⚠️ Webhook logic error for ${msgId}:`, err);
                await unlockMessage(msgId);
                return res.status(200).send('logic_error');
            }
        }
        return res.status(200).send('ignored');

    } catch (error) {
        console.error('❌ [Webhook] Fatal Error:', error);
        return res.status(200).send('fatal_error');
    }
}
