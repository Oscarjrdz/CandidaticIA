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
    saveWebhookTransaction
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

    // Support Hybrid Event Names (UltraMSG native vs Proxy/Wrapper)
    const eventType = data.event_type || data.event || data.eventName;
    const messageData = data.data || data;

    // 🏎️ FERRARI WEBHOOK OPTIMIZATION: Atomic Pipelining
    // We delay saving event/stats until we have the candidate context to做 it in 1 round-trip.

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
            if (await isMessageProcessed(msgId)) {
                return res.status(200).send('duplicate_ignored');
            }

            // IGNORE OUTGOING MESSAGES (Avoid loops/self-replies)
            if (messageData.fromMe || messageData.from_me) {
                return res.status(200).send('from_me_ignored');
            }

            try {
                // --- ADMIN COMMANDS & FILTERS ---
                // [Omitted for brevity in this replacement chunk, but keeping original logic flow]
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
                                return res.status(200).send('activation_error');
                            }
                        }
                    }
                }

                // --- PIN/YEAR GATEKEEPER ---
                // Allow 4-digit years (19xx, 20xx) to pass through.
                const bodyTrim = body.trim();
                const isAuthAttempt = /^\d{4}$/.test(bodyTrim);
                if (isAuthAttempt && !bodyTrim.startsWith('19') && !bodyTrim.startsWith('20')) {
                    return res.status(200).send('pin_ignored');
                }

                try {
                    const allUsers = await getUsers();
                    const isPending = allUsers.find(u => u.whatsapp.includes(phone) && u.status === 'Pending');
                    const isAdmin = phone.includes('8116038195');
                    if (isPending && !isAdmin) return res.status(200).send('pending_user_ignored');
                } catch (e) { }

                // 🏎️ FERRARI LOOKUP
                let candidateId = await getCandidateIdByPhone(phone);
                let candidate = null;

                if (candidateId) {
                    candidate = await getCandidateById(candidateId);
                    if (!candidate) candidateId = null; // Re-create if ghost
                }

                if (!candidateId) {
                    const newCandidate = await saveCandidate({
                        whatsapp: phone,
                        nombre: messageData.pushname || messageData.pushName || messageData.name || 'Desconocido',
                        origen: 'whatsapp_v2',
                        primerContacto: new Date().toISOString()
                    });
                    candidateId = newCandidate.id;
                    candidate = newCandidate;

                    // 📡 SSE: Notify real-time clients of new candidate
                    notifyNewCandidate(newCandidate).catch(err =>
                        console.warn('SSE notification failed:', err.message)
                    );
                }

                // 🛡️ [WEBHOOK TRANSCRIPTION SHIELD]: Ignore external transcriptions (likely from UltraMsg STT)
                // Only block if it's a chat/text message. PTT/Audio messages should never be blocked here.
                const isTextType = !messageData.type || messageData.type === 'chat' || messageData.type === 'text';
                const hasGhostPattern = String(body).includes('[AUDIO TRANSCRITO]') || String(body).includes('🎙️');

                if (isTextType && hasGhostPattern) {
                    console.log(`[AUDIO SHIELD] 🛡️ Blocked external text-transcription for ${phone}: ${body.substring(0, 30)}...`);
                    return res.status(200).send('transcription_ignored');
                }

                console.log(`[WEBHOOK] Incoming message from ${phone}: ${body.substring(0, 30)}...`);

                // --- ADMIN STICKER CAPTURE ---
                const messageType = messageData.type || 'text';
                if (phone === adminNumber && (messageType === 'sticker' || messageType === 'stickerMessage')) {
                    const stickerUrl = messageData.media || messageData.body || messageData.file;
                    if (stickerUrl && stickerUrl.startsWith('http')) {
                        const redis = getRedisClient();
                        await redis.set('bot_celebration_sticker', stickerUrl);
                        console.log(`[ADMIN] 🖼️ Celebration sticker captured and saved: ${stickerUrl}`);
                        await sendMessage(adminNumber, `✅ ¡Sticker de festejo guardado con éxito! Lo usaré cuando un candidato complete su perfil al 100%. ✨🎉`);
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
                    if (mediaUrl && mediaUrl.startsWith('http')) {
                        msgToSave.mediaUrl = mediaUrl;
                        agentInput = { type: 'audio', url: mediaUrl };
                    }
                } else if (messageData.media) {
                    msgToSave.mediaUrl = messageData.media;
                }

                // 🏎️ ATOMIC COMMIT (Pipelining)
                const updatedCandidate = {
                    ...candidate,
                    ultimoMensaje: new Date().toISOString(),
                    lastUserMessageAt: new Date().toISOString(),
                    unread: true
                };

                // Move some non-critical background tasks here
                const configPromise = getUltraMsgConfig();

                await saveWebhookTransaction({
                    candidateId,
                    message: msgToSave,
                    candidateUpdates: updatedCandidate,
                    eventData: data,
                    statsType: 'incoming'
                });

                // 🏎️ [IMMEDIATE PRESENCE] - Mark as read FIRST, then start typing (to avoid clearing state)
                const presenceUpdate = (async () => {
                    const config = await configPromise;
                    if (config) {
                        try {
                            // 1. Mark as read
                            await markUltraMsgAsRead(config.instanceId, config.token, from);
                            // 2. Start typing (Try both keywords for maximum compatibility)
                            await sendUltraMsgPresence(config.instanceId, config.token, from, 'composing');
                            await sendUltraMsgPresence(config.instanceId, config.token, from, 'typing');
                        } catch (e) { }
                    }
                })();

                // AI Processing in background with Industrial Waitlist
                const aiPromise = (async () => {
                    try {
                        const redis = getRedisClient();
                        const isActive = await redis?.get('bot_ia_active');
                        if (isActive === 'false') return;

                        // 🏁 1. ADD TO WAITLIST (Industrial Standard)
                        const waitlistValue = typeof agentInput === 'object' ? JSON.stringify(agentInput) : agentInput;
                        await addToWaitlist(candidateId, waitlistValue);

                        // 🏁 2. WORKER LOCK
                        const isLocked = await isCandidateLocked(candidateId);
                        if (isLocked) {
                            console.log(`[Industrial Queue] Candidate ${candidateId} is busy. Message added to waitlist.`);
                            return res.status(200).json({ status: 'queued', candidateId });
                        }

                        try {
                            // 🏁 3. WORKER LOOP: Process everything in the waitlist until drained
                            let loopSafety = 0;
                            while (loopSafety < 5) { // Max 5 cycles to avoid infinite loops
                                const pendingMsgs = await getWaitlist(candidateId);
                                if (pendingMsgs.length === 0) break;

                                const aggregatedText = pendingMsgs.join(' | ');
                                console.log(`[Industrial Queue] Processing ${pendingMsgs.length} aggregated messages for ${candidateId}.`);

                                // 🚀 ASYNC PROCESSING BIFURCATION
                                if (FEATURES.USE_MESSAGE_QUEUE) {
                                    const protocol = req.headers['x-forwarded-proto'] || 'https';
                                    const host = req.headers.host;
                                    const workerUrl = `${protocol}://${host}/api/workers/process-message`;

                                    await fetch(workerUrl, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            candidateId,
                                            message: aggregatedText,
                                            messageId: msgId,
                                            from: phone
                                        })
                                    });
                                } else {
                                    await processMessage(candidateId, aggregatedText, msgId);
                                }

                                loopSafety++;
                            }
                        } finally {
                            // 🏁 4. CRITICAL: Release the lock so subsequent messages aren't delayed by 15s
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
