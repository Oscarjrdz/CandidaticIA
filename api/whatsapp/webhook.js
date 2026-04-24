/**
 * ═══════════════════════════════════════════════════════════════════
 * 📡 WhatsApp Webhook Handler — Meta Cloud API
 * ═══════════════════════════════════════════════════════════════════
 * Receives webhook events from Meta's WhatsApp Cloud API.
 * Replaces all Baileys/GatewayWapp parsing with Meta's official format.
 * All business logic (admin commands, AI, Brenda, etc.) is preserved.
 * ═══════════════════════════════════════════════════════════════════
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
    markMessageAsDone,
    updateMessageReaction
} from '../utils/storage.js';
import { markMessageAsRead, downloadMetaMedia, uploadMediaToMeta } from './utils.js';
import { FEATURES } from '../utils/feature-flags.js';
import { sendMessage } from '../utils/messenger.js';
import { notifyNewCandidate } from '../utils/sse-notify.js';
import { logTelemetry } from '../utils/telemetry.js';

export const maxDuration = 60;

const isDebug = process.env.DEBUG_MODE === 'true';
if (!isDebug) {
    console.log = function () { };
}

/** Clean phone number to pure digits */
const cleanPhoneNumber = (raw = '') => {
    return String(raw).replace(/\D/g, '');
};

export default async function handler(req, res) {
    // ═══ META CLOUD API: Webhook Verification (GET) ═══
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'candidatic_webhook_2026';

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('[META WEBHOOK] ✅ Verification successful');
            return res.status(200).send(challenge);
        } else {
            return res.status(403).send('Forbidden');
        }
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const payload = req.body;

    // ═══ Debug: save raw webhook for inspection ═══
    try {
        const redis = getRedisClient();
        if (redis) {
            await redis.set('debug:last_webhook_raw', JSON.stringify(payload));
        }
    } catch (e) { }

    // ═══ META PAYLOAD EXTRACTION ═══
    // Meta sends: { object: "whatsapp_business_account", entry: [{ changes: [{ value: {...} }] }] }
    if (payload.object !== 'whatsapp_business_account') {
        return res.status(200).send('not_whatsapp');
    }

    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value) {
        return res.status(200).send('no_value');
    }

    try {
        // ════════════════════════════════════════════════
        // 1. HANDLE STATUS UPDATES (ACKs / Read receipts)
        // ════════════════════════════════════════════════
        if (value.statuses && value.statuses.length > 0) {
            for (const status of value.statuses) {
                const msgId = status.id;         // wamid.xxxxx
                const statusStr = status.status;  // sent, delivered, read, failed
                const recipientPhone = cleanPhoneNumber(status.recipient_id);

                if (!msgId || !statusStr) continue;

                try {
                    if (recipientPhone.length >= 10) {
                        const candidateId = await getCandidateIdByPhone(recipientPhone);
                        if (candidateId) {
                            // For failed messages, include the Meta error details
                            if (statusStr === 'failed' && status.errors?.length > 0) {
                                const metaError = status.errors[0];
                                const errorText = `Meta Error #${metaError.code}: ${metaError.title || metaError.message || 'Unknown'}`;
                                await updateMessageStatus(candidateId, msgId, statusStr, { error: errorText });

                                // Save debug info for last failure
                                const redis = getRedisClient();
                                if (redis) {
                                    redis.set('debug:last_meta_failure', JSON.stringify({
                                        timestamp: new Date().toISOString(),
                                        phone: recipientPhone,
                                        msgId,
                                        error: metaError
                                    }), 'EX', 86400).catch(() => {});
                                }
                            } else {
                                await updateMessageStatus(candidateId, msgId, statusStr);
                            }
                        }
                    }
                } catch (e) { /* Silent fail */ }

                // Handle specific failure actions
                if (statusStr === 'failed' && status.errors?.length > 0) {
                    const errorCode = status.errors[0]?.code;
                    // 131026 = number not on WhatsApp
                    if (errorCode === 131026) {
                        try {
                            const candidateId = await getCandidateIdByPhone(recipientPhone);
                            if (candidateId) {
                                await updateCandidate(candidateId, {
                                    status: 'Incontactable',
                                    incontactable: true,
                                    blocked: true
                                });
                            }
                        } catch (e) { }
                    }
                }
            }
            return res.status(200).send('status_processed');
        }

        // ════════════════════════════════════════════════
        // 2. HANDLE INCOMING MESSAGES
        // ════════════════════════════════════════════════
        if (value.messages && value.messages.length > 0) {
            for (const metaMsg of value.messages) {

            const contacts = value.contacts?.[0];
            const metadata = value.metadata;

            // ─── Extract core fields from Meta format ───
            const phone = cleanPhoneNumber(metaMsg.from);
            const msgId = metaMsg.id;  // wamid.xxxxx format
            const pushName = contacts?.profile?.name || 'Desconocido';
            const timestamp = metaMsg.timestamp;
            const metaMsgType = metaMsg.type; // text, image, audio, video, document, sticker, reaction, location, contacts

            // ─── Extract message body based on type ───
            let body = '';
            let mediaId = null;
            let mediaUrl = null;
            let messageType = metaMsgType;

            switch (metaMsgType) {
                case 'text':
                    body = metaMsg.text?.body || '';
                    messageType = 'text';
                    break;
                case 'image':
                    body = metaMsg.image?.caption || '';
                    mediaId = metaMsg.image?.id;
                    messageType = 'image';
                    break;
                case 'video':
                    body = metaMsg.video?.caption || '';
                    mediaId = metaMsg.video?.id;
                    messageType = 'video';
                    break;
                case 'audio':
                    mediaId = metaMsg.audio?.id;
                    messageType = metaMsg.audio?.voice ? 'ptt' : 'audio';
                    break;
                case 'document':
                    body = metaMsg.document?.caption || '';
                    mediaId = metaMsg.document?.id;
                    messageType = 'document';
                    break;
                case 'sticker':
                    mediaId = metaMsg.sticker?.id;
                    messageType = 'sticker';
                    break;
                case 'reaction':
                    // Handle reaction separately below
                    break;
                case 'location':
                    body = `📍 Ubicación: ${metaMsg.location?.latitude}, ${metaMsg.location?.longitude}`;
                    messageType = 'location';
                    break;
                case 'button':
                    body = metaMsg.button?.text || '';
                    messageType = 'text';
                    break;
                case 'interactive':
                    body = metaMsg.interactive?.button_reply?.title ||
                           metaMsg.interactive?.list_reply?.title || '';
                    messageType = 'text';
                    break;
                default:
                    body = '';
                    messageType = metaMsgType || 'text';
            }

            // ─── Download media URL if present ───
            if (mediaId) {
                try {
                    const mediaData = await downloadMetaMedia(mediaId);
                    if (mediaData?.buffer) {
                        const redis = getRedisClient();
                        if (redis) {
                            const base64Data = mediaData.buffer.toString('base64');
                            if (base64Data.length < 15 * 1024 * 1024) { // Guard against huge files crashing Redis
                                const id = `in_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                                const key = `image:${id}`;
                                const metaKey = `meta:image:${id}`;
                                const mimeType = mediaData.mimeType || 'application/octet-stream';

                                await Promise.all([
                                    redis.set(key, base64Data, 'EX', 172800), // 48 hours TTL
                                    redis.set(metaKey, JSON.stringify({
                                        mime: mimeType,
                                        filename: `media_${mediaId}`,
                                        size: mediaData.fileSize || base64Data.length,
                                        createdAt: new Date().toISOString()
                                    }), 'EX', 172800)
                                ]);
                                
                                mediaUrl = `/api/image?id=${id}`;
                                console.log(`[Webhook] ✅ Media guardada localmente: ${mediaUrl} (${mimeType})`);
                            } else {
                                mediaUrl = mediaData.url; // Fallback to Meta URL if too large
                            }
                        } else {
                            mediaUrl = mediaData.url; // Fallback to Meta URL if no Redis
                        }
                    } else if (mediaData?.url) {
                        mediaUrl = mediaData.url;
                    }
                } catch (e) {
                    console.error('Error downloading media:', e.message);
                }
            }

            // 🛡️ BLOCK GROUPS (Meta doesn't send group messages to Cloud API by default, but just in case)
            if (phone.length < 10 || phone.length > 13) {
                continue;
            }
            if (phone.length >= 12 && !phone.startsWith('52')) {
                continue;
            }

            // 🛡️ DEDUP
            if (await isMessageProcessed(msgId)) {
                continue;
            }

            // 🛡️ IGNORE OLD MESSAGES
            if (timestamp) {
                const msgTimeMs = Number(timestamp) > 1e11 ? Number(timestamp) : Number(timestamp) * 1000;
                const diffMins = (Date.now() - msgTimeMs) / 1000 / 60;
                if (diffMins > 5) {
                    continue;
                }
            }

            // (Removed markMessageAsRead automatically so it only turns blue when recruiter OPENS the chat)

            await logTelemetry('ingress', {
                msgId, from: phone, type: messageType,
                text: body?.substring(0, 50)
            });

            try {
                // ═══ ADMIN COMMANDS ═══
                const adminNumber = process.env.ADMIN_NUMBER || '5218116038195';
                const redis = getRedisClient();
                const isAdmin = phone.slice(-10) === adminNumber.slice(-10);

                if (isAdmin) {
                    const lowerBody = body.toLowerCase().trim();

                    // ── BRIDGE LEARNING COMMANDS ──
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
                        continue;
                    }

                    // ── MOSTRAR PUENTES ──
                    if (lowerBody.includes('mostrar puentes')) {
                        const ALL_BRIDGES = [
                            { key: 'bot_celebration_sticker', label: '1️⃣ Extracción Completa', desc: 'Se manda cuando el perfil del candidato queda 100% listo.' },
                            { key: 'bot_step_move_sticker', label: '2️⃣ Paso Inicio', desc: 'Se manda al avanzar de un paso al siguiente (puente genérico).' },
                            { key: 'bot_bridge_cita', label: '3️⃣ Cita', desc: 'Se manda cuando el candidato acepta agendar entrevista.' },
                            { key: 'bot_bridge_exit', label: '4️⃣ No Interesa', desc: 'Se manda cuando el candidato rechaza todas las vacantes.' }
                        ];

                        let anyFound = false;
                        for (const bridge of ALL_BRIDGES) {
                            const rawData = await redis.get(bridge.key);
                            let stickerUrl = rawData;
                            let metaMediaId = null;
                            if (rawData?.startsWith('{')) {
                                try {
                                    const parsed = JSON.parse(rawData);
                                    stickerUrl = parsed.url;
                                    metaMediaId = parsed.mediaId;
                                } catch (e) {}
                            }

                            await sendMessage(adminNumber, `${bridge.label}\n📌 ${bridge.desc}\n${stickerUrl ? '✅ Configurado' : '❌ Sin configurar aún'}`);
                            if (stickerUrl) {
                                await sendMessage(adminNumber, stickerUrl, 'sticker', { mediaId: metaMediaId });
                                anyFound = true;
                            }
                        }
                        if (!anyFound) await sendMessage(adminNumber, '⚠️ Ningún puente configurado todavía. Usa los comandos *APRENDER PUENTE...* para enseñarle a Brenda.');
                        continue;
                    }

                    // ── VINCULAR GRUPO (not applicable for Meta API, but kept for compat) ──

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
                                    continue;
                                } else {
                                    await sendMessage(adminNumber, `❌ No encontré ningún usuario pendiente con el número ${targetPhone}.`);
                                    continue;
                                }
                            } catch (err) {
                                console.error('Error activating user:', err);
                            }
                        }
                    }
                }

                // ── GATEKEEPERS ──
                const bodyTrim = body.trim();
                const isAuthAttempt = /^\d{4}$/.test(bodyTrim);
                if (isAuthAttempt && !bodyTrim.startsWith('19') && !bodyTrim.startsWith('20')) {
                    continue;
                }

                try {
                    const allUsers = await getUsers();
                    const isPending = allUsers.find(u => u.whatsapp.includes(phone) && u.status === 'Pending');
                    if (isPending && phone !== '8116038195') continue;
                } catch (e) { }

                // ── 🌪️ RESET COMMAND INTERCEPTOR ──
                const upperBody = body?.toUpperCase().trim() || '';
                if (upperBody.startsWith('RESET')) {
                    let targetPhone = phone;

                    if (phone.slice(-10) === adminNumber.slice(-10)) {
                        const extractedDigits = upperBody.replace('RESET', '').replace(/\D/g, '');
                        if (extractedDigits && extractedDigits.length >= 10) {
                            targetPhone = extractedDigits;
                        }
                    }

                    const targetCandId = await getCandidateIdByPhone(targetPhone);
                    if (targetCandId) {
                        await deleteCandidate(targetCandId);
                        await sendMessage(phone, `✅ *RESET COMPLETADO*\nEl historial y perfil del número \`${targetPhone}\` han sido borrados.\n\nEscribe "Hola" para reiniciar el flujo como un candidato nuevo.`);
                    } else {
                        await sendMessage(phone, `⚠️ *Aviso*: El número \`${targetPhone}\` no existe en la base de datos o ya fue reseteado.`);
                    }
                    continue;
                }

                // ═══ CANDIDATE LOOKUP ═══
                let candidateId = await getCandidateIdByPhone(phone);
                let candidate = null;

                if (candidateId) {
                    candidate = await getCandidateById(candidateId);
                    if (!candidate) candidateId = null;
                }


                if (!candidateId) {
                    candidate = await saveCandidate({
                        whatsapp: phone,
                        nombre: pushName,
                        origen: 'meta_cloud_api',
                        esNuevo: 'SI',
                        primerContacto: new Date().toISOString()
                    });
                    candidateId = candidate.id;
                    notifyNewCandidate(candidate).catch(() => { });
                }

                // ── ADMIN STICKER CAPTURE ──
                if (phone.slice(-10) === adminNumber.slice(-10) && messageType === 'sticker' && mediaUrl) {
                    const adminState = await redis.get(`admin_state:${phone}`);

                    if (adminState?.startsWith('waiting_bridge_sticker:')) {
                        const redisKey = adminState.split('waiting_bridge_sticker:')[1];
                        const BRIDGE_LABELS = {
                            'bot_celebration_sticker': 'Extracción Completa',
                            'bot_step_move_sticker': 'Paso Inicio',
                            'bot_bridge_cita': 'Cita',
                            'bot_bridge_exit': 'No Interesa'
                        };
                        const label = BRIDGE_LABELS[redisKey] || redisKey;

                        let outboundMediaId = mediaId;
                        try {
                            const imageId = mediaUrl.split('?id=')[1];
                            if (imageId) {
                                const base64 = await redis.get(`image:${imageId}`);
                                if (base64) {
                                    const buffer = Buffer.from(base64, 'base64');
                                    const uploadResult = await uploadMediaToMeta(buffer, 'image/webp', 'sticker.webp');
                                    if (uploadResult?.mediaId) {
                                        outboundMediaId = uploadResult.mediaId;
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('Error uploading bridge sticker to Meta:', e);
                        }

                        await redis.set(redisKey, JSON.stringify({ url: mediaUrl, mediaId: outboundMediaId }));
                        await redis.del(`admin_state:${phone}`);
                        await sendMessage(adminNumber, `✅ ¡Puente *"${label}"* guardado con éxito! 🚀\n\nClave: \`${redisKey}\``);
                        continue;
                    }
                    // If not waiting for a bridge sticker, fall through and treat as normal candidate message
                }

                // ── DEV SCREENSHOT CAPTURE ──
                if (phone.slice(-10) === adminNumber.slice(-10) && (messageType === 'image' || messageType === 'video' || messageType === 'document')) {
                    if (mediaUrl && body?.toLowerCase().includes('screen')) {
                        await redis.set('dev_last_screenshot', mediaUrl, 'EX', 86400);
                        await sendMessage(adminNumber, `📸 Screenshot guardado. La IA puede consultarlo ahora.`);
                        continue;
                    }
                }

                // ═══ BUILD MESSAGE TO SAVE ═══
                const agentInput = body;
                const msgToSave = {
                    id: msgId,
                    from: 'user',
                    content: body,
                    type: messageType,
                    timestamp: new Date().toISOString()
                };

                // ── QUOTE HANDLING (Meta context) ──
                if (metaMsg.context?.id) {
                    msgToSave.contextInfo = {
                        quotedMessage: {
                            stanzaId: metaMsg.context.id,
                            participant: metaMsg.context.from || '',
                            text: '' // Meta doesn't include quoted text in webhook
                        }
                    };
                }

                // ── REACTION HANDLING ──
                if (metaMsgType === 'reaction') {
                    const reactionData = metaMsg.reaction;
                    if (reactionData) {
                        const targetMsgId = reactionData.message_id;
                        const emoji = reactionData.emoji || '';

                        if (targetMsgId && candidateId) {
                            await updateMessageReaction(candidateId, targetMsgId, emoji);
                            const redis = getRedisClient();
                            if (redis) await redis.del('stats:bot:last_calc');
                        }
                        continue;
                    }
                }

                if (mediaUrl) {
                    msgToSave.mediaUrl = mediaUrl;
                }

                // ═══ PERSISTENCE ═══
                const freshCandidate = await getCandidateById(candidateId) || candidate;

                const updatedCandidate = {
                    ...freshCandidate,
                    ultimoMensaje: new Date().toISOString(),
                    lastUserMessageAt: new Date().toISOString(),
                    unreadMsgCount: (Number(freshCandidate?.unreadMsgCount) || 0) + 1,
                    mensajesTotales: (Number(freshCandidate?.mensajesTotales) || 0) + 1
                };

                await saveWebhookTransaction({
                    candidateId,
                    message: msgToSave,
                    candidateUpdates: updatedCandidate,
                    eventData: metaMsg,
                    statsType: 'incoming'
                });

                // Force instant SSE stat recalculation
                const redisForCache = getRedisClient();
                if (redisForCache) {
                    await redisForCache.del('stats:bot:last_calc');
                }

                // ═══ AI PROCESSING (Turbo Mode) ═══
                const aiPromise = (async () => {
                    try {
                        const redis = getRedisClient();
                        let isBotActive = await redis?.get('bot_ia_active') !== 'false';

                        if (!isBotActive || candidate?.blocked === true) return;

                        let finalAgentInput = agentInput;

                        // 🎧 AUDIO TRANSCRIPTION
                        if ((messageType === 'audio' || messageType === 'ptt') && mediaId) {
                            try {
                                const aiConfigStr = await redis?.get('ai_config');
                                const aiConfig = aiConfigStr ? JSON.parse(aiConfigStr) : {};
                                const openAiKey = aiConfig.openaiApiKey || process.env.OPENAI_API_KEY;

                                if (openAiKey && mediaUrl) {
                                    const axios = (await import('axios')).default;
                                    // Download audio from Meta's CDN
                                    const mediaData = await downloadMetaMedia(mediaId);
                                    if (mediaData?.buffer) {
                                        const FormData = (await import('form-data')).default;
                                        const formData = new FormData();
                                        formData.append('file', mediaData.buffer, {
                                            filename: 'audio.ogg',
                                            contentType: mediaData.mimeType || 'audio/ogg'
                                        });
                                        formData.append('model', 'whisper-1');
                                        formData.append('language', 'es');

                                        const whisperRes = await axios.post(
                                            'https://api.openai.com/v1/audio/transcriptions',
                                            formData,
                                            {
                                                headers: {
                                                    'Authorization': `Bearer ${openAiKey}`,
                                                    ...formData.getHeaders()
                                                }
                                            }
                                        );

                                        if (whisperRes.data?.text) {
                                            finalAgentInput = `🎙️ [AUDIO TRANSCRITO]: "${whisperRes.data.text}"`;
                                        }
                                    }
                                }
                            } catch (e) {
                                finalAgentInput = `[DEV-ERR] Whisper: ${e.message}`;
                            }

                            try {
                                await redis.set('debug_last_audio_input', finalAgentInput);
                            } catch (e) { }
                        }

                        // 🏁 1. ADD TO WAITLIST
                        await addToWaitlist(candidateId, { text: finalAgentInput, msgId });

                        // 🏁 2. TRIGGER TURBO ENGINE
                        const { runTurboEngine } = await import('../workers/process-message.js');
                        await runTurboEngine(candidateId, phone);

                    } catch (error) {
                        console.error('❌ AI Queueing Error:', error);
                    }
                })();

                await Promise.allSettled([aiPromise]);

                continue;

            } catch (err) {
                console.error(`⚠️ Webhook logic error for ${msgId}:`, err);
                await unlockMessage(msgId);
                continue;
            }
            }
            return res.status(200).send('success');
        }

        return res.status(200).send('ignored');

    } catch (error) {
        console.error('❌ [Webhook] Fatal Error:', error);
        await logTelemetry('ingress_fatal', { error: error.message });
        return res.status(200).send('fatal_error');
    }
}
