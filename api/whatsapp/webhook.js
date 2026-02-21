/**
 * WhatsApp Webhook Handler
 * Restauración estable a commit aee08cc
 * Timestamp: 2026-02-20T22:00:00
 */
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
import { logTelemetry } from '../utils/telemetry.js';

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

            if (await isMessageProcessed(msgId)) {
                await logTelemetry('ingress_duplicate', { msgId, from });
                return res.status(200).send('duplicate_ignored');
            }

            // IGNORE OUTGOING MESSAGES
            if (messageData.fromMe || messageData.from_me) {
                await logTelemetry('ingress_ignored_outgoing', { msgId, from });
                return res.status(200).send('from_me_ignored');
            }

            await logTelemetry('ingress', {
                msgId,
                from,
                type: messageData.type,
                text: body?.substring(0, 50)
            });

            try {
                // --- ADMIN COMMANDS ---
                const adminNumber = '5218116038195';
                const redis = getRedisClient();

                if (phone === adminNumber) {
                    const lowerBody = body.toLowerCase().trim();

                    // Command: Aprender puente
                    if (lowerBody.includes('aprender puente')) {
                        await redis.set(`admin_state:${phone}`, 'waiting_bridge_sticker');
                        await sendMessage(adminNumber, `¡Claro! 🌸 Mándame el STICKER que quieres usar como *puente visual* (el que sale cuando aceptan la vacante). ✨`);
                        return res.status(200).send('bridge_mode_active');
                    }

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
                        esNuevo: 'SI', // Brújula interna: Fase de presentación
                        primerContacto: new Date().toISOString()
                    });
                    candidateId = candidate.id;
                    notifyNewCandidate(candidate).catch(() => { });
                }

                console.log(`[WEBHOOK] Incoming message from ${phone}: ${body.substring(0, 30)}...`);

                // --- ADMIN STICKER CAPTURE ---
                const messageType = messageData.type || 'text';
                if (phone === adminNumber && (messageType === 'sticker' || messageType === 'stickerMessage')) {
                    const stickerUrl = messageData.media || messageData.body || messageData.file;
                    if (stickerUrl?.startsWith('http')) {
                        const adminState = await redis.get(`admin_state:${phone}`);

                        if (adminState === 'waiting_bridge_sticker') {
                            await redis.set('bot_step_move_sticker', stickerUrl);
                            await redis.del(`admin_state:${phone}`);
                            await sendMessage(adminNumber, `✅ ¡Puente visual guardado con éxito! 🚀✨\nAhora usaré este sticker cuando los candidatos acepten la vacante.`);
                            return res.status(200).send('bridge_sticker_captured');
                        } else {
                            // Default: Celebration sticker
                            await redis.set('bot_celebration_sticker', stickerUrl);
                            await sendMessage(adminNumber, `✅ ¡Sticker de festejo (fin de perfil) guardado! ✨🎉`);
                            return res.status(200).send('celebration_sticker_captured');
                        }
                    }
                }

                const agentInput = body;
                const msgToSave = {
                    id: msgId,
                    from: 'user', content: body, type: messageType,
                    timestamp: new Date().toISOString()
                };

                if (messageData.media) {
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

                // --- AI PROCESSING (Turbo Mode - Async Queue) ---
                const aiPromise = (async () => {
                    try {
                        const redis = getRedisClient();
                        const isActive = await redis?.get('bot_ia_active');
                        if (isActive === 'false' || candidate?.blocked === true) return;

                        // 🏁 1. ADD TO WAITLIST (Safe persistence)
                        await addToWaitlist(candidateId, { text: agentInput, msgId });

                        // 🏁 2. SIGNAL TURBO ENGINE (Serverless Trigger)
                        const protocol = req.headers['x-forwarded-proto'] || 'https';
                        const host = req.headers.host;
                        const workerUrl = `${protocol}://${host}/api/workers/process-message`;

                        console.log(`[Vercel Turbo] 🚀 Triggering engine for candidate ${candidateId}`);

                        // Fire-and-forget trigger (don't await)
                        fetch(workerUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ candidateId, from: phone })
                        }).catch(err => console.error('[Vercel Turbo] Trigger Fail:', err.message));

                    } catch (error) {
                        console.error('❌ AI Queueing Error:', error);
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

                // 🔥 CRITICAL META-OPTIMIZATION: Respond to UltraMsg IMMEDIATELY.
                // This ensures <100ms latency on the webhook acknowledgment.
                res.status(200).send('success');

                // We await the side-effects *after* sending the response to keep the Vercel 
                // serverless function alive until all tasks (presence, queueing) finish.
                await Promise.allSettled([miscPromise, presenceUpdate, aiPromise]);
                return;

            } catch (err) {
                console.error(`⚠️ Webhook logic error for ${msgId}:`, err);
                await unlockMessage(msgId);
                return res.status(200).send('logic_error');
            }
        }
        return res.status(200).send('ignored');

    } catch (error) {
        console.error('❌ [Webhook] Fatal Error:', error);
        await logTelemetry('ingress_fatal', { error: error.message });
        return res.status(200).send('fatal_error');
    }
}
