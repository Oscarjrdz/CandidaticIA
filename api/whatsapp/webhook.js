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
    deleteCandidate,
    getUsers,
    saveUser,
    saveWebhookTransaction,
    markMessageAsDone
} from '../utils/storage.js';
import { getUltraMsgConfig, getUltraMsgContact } from './utils.js';
import { FEATURES } from '../utils/feature-flags.js';
import { sendMessage } from '../utils/messenger.js';
import { notifyNewCandidate } from '../utils/sse-notify.js';
import { logTelemetry } from '../utils/telemetry.js';
// 🚀 TURBO MODE: Silence all synchronous Vercel console I/O unless actively debugging
if (process.env.DEBUG_MODE !== 'true') {
    console.log = function () { };
}

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
                const adminNumber = process.env.ADMIN_NUMBER || '5218116038195';
                const redis = getRedisClient();

                if (phone === adminNumber) {
                    const lowerBody = body.toLowerCase().trim();

                    // ---- BRIDGE LEARNING COMMANDS ----
                    // Map of exact command phrases → { redisKey, label }
                    const BRIDGE_COMMANDS = {
                        'aprender puente extraccion completa': {
                            key: 'bot_celebration_sticker',
                            label: 'Extracción Completa (festejo de perfil listo)'
                        },
                        'aprender puente paso inicio': {
                            key: 'bot_step_move_sticker',
                            label: 'Paso Inicio (avance genérico entre pasos)'
                        },
                        'aprender puente cita': {
                            key: 'bot_bridge_cita',
                            label: 'Cita (cuando el candidato acepta agendar)'
                        },
                        'aprender puente cuando no interesa': {
                            key: 'bot_bridge_exit',
                            label: 'No Interesa (salida del flujo de vacantes)'
                        }
                    };

                    const matchedCommand = Object.keys(BRIDGE_COMMANDS).find(cmd => lowerBody.includes(cmd));
                    if (matchedCommand) {
                        const { key, label } = BRIDGE_COMMANDS[matchedCommand];
                        await redis.set(`admin_state:${phone}`, `waiting_bridge_sticker:${key}`);
                        await sendMessage(adminNumber, `✅ Listo. Ahora mándame el *STICKER* que quieres usar como puente para:\n\n🎯 *${label}*\n\nEspero tu sticker... 🌸`);
                        return res.status(200).send('bridge_mode_active');
                    }

                    // ---- MOSTRAR PUENTES ----
                    if (lowerBody.includes('mostrar puentes')) {
                        const ALL_BRIDGES = [
                            { key: 'bot_celebration_sticker', label: '1️⃣ Extracción Completa', desc: 'Se manda cuando el perfil del candidato queda 100% listo.' },
                            { key: 'bot_step_move_sticker', label: '2️⃣ Paso Inicio', desc: 'Se manda al avanzar de un paso al siguiente (puente genérico).' },
                            { key: 'bot_bridge_cita', label: '3️⃣ Cita', desc: 'Se manda cuando el candidato acepta agendar entrevista.' },
                            { key: 'bot_bridge_exit', label: '4️⃣ No Interesa', desc: 'Se manda cuando el candidato rechaza todas las vacantes.' }
                        ];

                        let anyFound = false;
                        for (const bridge of ALL_BRIDGES) {
                            const stickerUrl = await redis.get(bridge.key);
                            await sendMessage(adminNumber, `${bridge.label}\n📌 ${bridge.desc}\n${stickerUrl ? '✅ Configurado' : '❌ Sin configurar aún'}`);
                            if (stickerUrl?.startsWith('http')) {
                                await sendMessage(adminNumber, stickerUrl, 'sticker');
                                anyFound = true;
                            }
                        }
                        if (!anyFound) await sendMessage(adminNumber, '⚠️ Ningún puente configurado todavía. Usa los comandos *APRENDER PUENTE...* para enseñarle a Brenda.');
                        return res.status(200).send('bridges_shown');
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

                // --- 🌪️ RESET COMMAND INTERCEPTOR ---
                const upperBody = body?.toUpperCase().trim() || '';
                if (upperBody.startsWith('RESET')) {
                    let targetPhone = phone; // Default: Reset own number

                    if (phone === adminNumber) {
                        // Admin can pass a number: "RESET 8120313481" or "RESET+528120313481"
                        const extractedDigits = upperBody.replace('RESET', '').replace(/\D/g, '');
                        if (extractedDigits && extractedDigits.length >= 10) {
                            targetPhone = extractedDigits;
                        }
                    }

                    const targetCandId = await getCandidateIdByPhone(targetPhone);
                    if (targetCandId) {
                        await deleteCandidate(targetCandId);
                        console.log(`[WEBHOOK/RESET] 💥 Data wiped for candidate ${targetCandId} (${targetPhone}) via WhatsApp command.`);
                        await sendMessage(phone, `✅ *RESET COMPLETADO*\nEl historial y perfil del número \`${targetPhone}\` han sido borrados.\n\nEscribe "Hola" para reiniciar el flujo como un candidato nuevo.`);
                    } else {
                        await sendMessage(phone, `⚠️ *Aviso*: El número \`${targetPhone}\` no existe en la base de datos o ya fue reseteado.`);
                    }
                    return res.status(200).send('reset_processed');
                }

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

                        if (adminState?.startsWith('waiting_bridge_sticker:')) {
                            // The part after ':' is the exact Redis key to save to
                            const redisKey = adminState.split('waiting_bridge_sticker:')[1];

                            const BRIDGE_LABELS = {
                                'bot_celebration_sticker': 'Extracción Completa',
                                'bot_step_move_sticker': 'Paso Inicio',
                                'bot_bridge_cita': 'Cita',
                                'bot_bridge_exit': 'No Interesa'
                            };
                            const label = BRIDGE_LABELS[redisKey] || redisKey;

                            await redis.set(redisKey, stickerUrl);
                            await redis.del(`admin_state:${phone}`);
                            await sendMessage(adminNumber, `✅ ¡Puente *"${label}"* guardado con éxito! 🚀\n\nClave: \`${redisKey}\``);
                            return res.status(200).send('bridge_sticker_captured');

                        } else {
                            // Default: Celebration sticker (if no pending command)
                            await redis.set('bot_celebration_sticker', stickerUrl);
                            await sendMessage(adminNumber, `✅ ¡Sticker de festejo (fin de perfil) guardado! ✨🎉`);
                            return res.status(200).send('celebration_sticker_captured');
                        }
                    }
                }

                // --- DEV SCREENSHOT CAPTURE ---
                if (phone === adminNumber && (messageType === 'image' || messageType === 'video' || messageType === 'document')) {
                    const mediaUrl = messageData.media || messageData.file; // Only use actual media fields, never body
                    if (mediaUrl?.startsWith('http') && body?.toLowerCase().includes('screen')) {
                        const redis = getRedisClient();
                        await redis.set('dev_last_screenshot', mediaUrl, 'EX', 86400); // Keep 24h
                        await sendMessage(adminNumber, `📸 Screenshot guardado. La IA puede consultarlo ahora.`);
                        return res.status(200).send('dev_screenshot_captured');
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

                // --- AI PROCESSING (Turbo Mode - Async Queue) ---
                const aiPromise = (async () => {
                    try {
                        const redis = getRedisClient();
                        const isActive = await redis?.get('bot_ia_active');
                        if (isActive === 'false' || candidate?.blocked === true) return;

                        // 🏁 1. ADD TO WAITLIST (Safe persistence)
                        await addToWaitlist(candidateId, { text: agentInput, msgId });

                        // 🏁 2. SIGNAL TURBO ENGINE DIRECTLY (Keep container alive)
                        console.log(`[Vercel Turbo] 🚀 Triggering internal engine for candidate ${candidateId}`);

                        // Import dynamically to avoid circular dependencies and load only when needed
                        const { runTurboEngine } = await import('../workers/process-message.js');
                        await runTurboEngine(candidateId, phone);

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

                // 🔥 Keep Vercel container alive by awaiting all side-effects BEFORE responding.
                // UltraMsg may retry if this takes >5s, but our Redis deduplication lock will catch and ignore it.
                await Promise.allSettled([miscPromise, aiPromise]);

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
        await logTelemetry('ingress_fatal', { error: error.message });
        return res.status(200).send('fatal_error');
    }
}
