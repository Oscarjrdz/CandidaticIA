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
    markMessageAsDone,
    updateMessageReaction
} from '../utils/storage.js';
import { getUltraMsgConfig, getUltraMsgContact } from './utils.js';
import { FEATURES } from '../utils/feature-flags.js';
import { sendMessage } from '../utils/messenger.js';
import { notifyNewCandidate } from '../utils/sse-notify.js';
import { logTelemetry } from '../utils/telemetry.js';

export const maxDuration = 60; // Extend Vercel timeout to prevent LLM latency silence

const isDebug = process.env.DEBUG_MODE === 'true';
// 🚀 TURBO MODE: Silence all synchronous Vercel console I/O unless actively debugging
if (!isDebug) {
    console.log = function () { };
}

/**
 * 🧹 Limpia un JID/número de WhatsApp a dígitos puros.
 * Elimina sufijos de multi-dispositivo como ":15" antes de extraer dígitos.
 * Ej: "521812345678:15@s.whatsapp.net" → "521812345678"
 */
const cleanPhoneNumber = (raw = '') => {
    // Remover sufijo de dispositivo (:NN) antes de @
    const withoutDevice = raw.split('@')[0].split(':')[0];
    return withoutDevice.replace(/\D/g, '');
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const payload = req.body;
    const eventType = payload.event_type || payload.event || payload.eventName;
    const messageData = payload.data || payload; // Fallback to payload if data is not present

    try {
        const redis = await import('../utils/storage.js').then(m => m.getRedisClient());
        if (redis) {
            await redis.set('debug:last_webhook_raw', JSON.stringify({ eventType, body: req.body }));
        }
    } catch(e) {}

    if (!eventType) {
        return res.status(200).json({ success: true, message: 'Heartbeat or invalid payload' });
    }

    try {
        // 1. Handle Message Acknowledgments
        if (
            eventType === 'message_ack' || 
            eventType === 'message.ack' || 
            eventType === 'messages.update' || 
            eventType === 'MESSAGES_UPDATE'
        ) {
            let id, status, to;
            
            // Standard UltraMsg/Gateway
            if (messageData.id && messageData.status) {
                id = messageData.id;
                status = messageData.status;
                to = messageData.to;
            } 
            // EvolutionAPI messages.update
            else if (messageData.key || (Array.isArray(messageData) && messageData[0]?.key)) {
                const md = Array.isArray(messageData) ? messageData[0] : messageData;
                id = md.key?.id;
                status = md.update?.status;
                to = md.key?.remoteJid;
                
                try {
                    const redis = await import('../utils/storage.js').then(m => m.getRedisClient());
                    if (redis) await redis.set('debug:last_ack', JSON.stringify({ eventType, parsedId: id, parsedStatus: status, raw: messageData, md }));
                } catch(e){}
            }

            if (!id || !status) return res.status(200).send('ignored_missing_ack_data');

            // 🟢 WA STATUS VIEW (ACK directed to status@broadcast)
            const remoteJid = messageData.__raw?.key?.remoteJid || to || '';
            if (remoteJid.includes('status@broadcast') && (status === 'read' || status === 'played')) {
                const spectatorJid = messageData.__raw?.key?.participant || messageData.__raw?.participant;
                if (spectatorJid) {
                    const spectatorPhone = cleanPhoneNumber(spectatorJid);
                    // MUST extract storyId from raw.key.id because the Gateway maps it explicitly there
                    const storyId = messageData.__raw?.key?.id || id;
                    try {
                        const redis = getRedisClient();
                        if (redis) {
                            const rawStories = await redis.lrange('wa_stories', 0, -1);
                            if (rawStories && rawStories.length > 0) {
                                let updated = false;
                                const mutations = [];
                                for (const raw of rawStories) {
                                    try {
                                        const parsed = JSON.parse(raw);
                                        // Match story using substring or precise ID since Baileys might slightly alter IDs
                                        if (parsed.id === storyId || parsed.id?.includes(storyId)) {
                                            if (!parsed.views) parsed.views = [];
                                            if (!parsed.views.includes(spectatorPhone)) {
                                                parsed.views.push(spectatorPhone);
                                                updated = true;
                                            }
                                        }
                                        mutations.push({ old: raw, newStr: JSON.stringify(parsed) });
                                    } catch (err) {}
                                }
                                // Update DB atomically
                                if (updated) {
                                    const pipeline = redis.pipeline();
                                    mutations.forEach(m => {
                                        if (m.old !== m.newStr) {
                                            pipeline.lrem('wa_stories', 0, m.old);
                                            // Put it back to the end of list. Since we lrange 0 to -1, order might shift slightly, 
                                            // but this is an ID based update so it's fine for simple display. For robustness, 
                                            // ideally we use hashes, but lists are fine for ~20 items.
                                            pipeline.lpush('wa_stories', m.newStr);
                                        }
                                    });
                                    await pipeline.exec();
                                    if (isDebug) console.log(`[VISTO 👀] Candidato ${spectatorPhone} vio el estado WA ID: ${storyId}`);
                                }
                            }
                        }
                    } catch (e) { console.error('Error procesando View de Status:', e.message); }
                }
            }

            try {
                // 🛡️ Use cleanPhoneNumber to strip device suffix (e.g. :15) before lookup
                const phone = cleanPhoneNumber(to || '');
                if (phone.length >= 10 && !remoteJid.includes('status@broadcast')) {
                    const candidateId = await getCandidateIdByPhone(phone);
                    if (candidateId) await updateMessageStatus(candidateId, id, status);
                }
            } catch (ackErr) { /* Silent fail */ }
            return res.status(200).send('ok');
        }

        // 2. Handle Incoming Messages (UltraMsg & GatewayWapp/EvolutionAPI hybrid check)
        if (eventType === 'message_received' || eventType === 'message.incoming' || eventType === 'messages.upsert') {
            
            // 🔄 Extracción profunda para Baileys/EvolutionAPI (puede venir dentro de un arreglo 'messages')
            let mData = messageData;
            if (messageData.messages && Array.isArray(messageData.messages) && messageData.messages.length > 0) {
                mData = messageData.messages[0];
            }

            const fromRaw = mData.from || mData.remoteJid || mData.key?.remoteJid || '';
            const from = fromRaw;
            const bodyRaw = mData.body || mData.message?.conversation || mData.message?.extendedTextMessage?.text || mData.message?.imageMessage?.caption || '';
            const body = bodyRaw;
            const msgId = mData.id || mData.key?.id || `msg_${Date.now()}`;
            
            // Override messageData para el resto de la función si sacamos el dato del array
            if (mData !== messageData) {
                Object.assign(messageData, mData); // Mutar seguro para retrocompatibilidad
            }
            
            // 🛡️ BLOCK GROUPS AND STATUS BROADCASTS
            if (from.includes('@g.us') || from.includes('status@broadcast') || from.includes('newsletter')) {
                
                // EXCEPCIÓN: Permitir comando VINCULAR GRUPO
                if (from.includes('@g.us') && body.trim().toUpperCase() === 'VINCULAR GRUPO') {
                    const adminNumber = process.env.ADMIN_NUMBER || '5218116038195';
                    const senderJid = mData.participant || mData.key?.participant || mData.__raw?.key?.participant || mData.__raw?.participant || '';
                    const senderPhone = cleanPhoneNumber(senderJid);
                    
                    if (senderPhone.slice(-10) === adminNumber.slice(-10)) {
                        try {
                            const redis = getRedisClient();
                            if (redis) {
                                await redis.set('ventas_grupo_id', from);
                                const vInstanceId = messageData.instanceId || payload.instanceId || payload.instance?.instanceId || req.headers['x-instance-id'];
                                await sendMessage(from, '✅ Grupo vinculado con éxito. Los reportes automáticos se enviarán aquí.', 'chat', { _instanceId: vInstanceId });
                            }
                        } catch(e) { console.error('Error al vincular grupo:', e); }
                        return res.status(200).send('grupo_vinculado');
                    }
                }

                if (isDebug) console.log(`[WEBHOOK/SPAM-PROTECT] Ignorando mensaje de sistema/grupo: ${from}`);
                return res.status(200).send('broadcast_ignored');
            }

            // 🧹 Strip device suffix before extracting digits (prevents ghost duplicates)
            const phone = cleanPhoneNumber(from);
            
            // 🛡️ BLOCK ALIEN NUMBERS
            // Regla 1: Longitud mínima/máxima (bloquea IDs de Meta/FB y números corruptos)
            if (phone.length < 10 || phone.length > 13) {
                if (isDebug) console.log(`[WEBHOOK/SPAM-PROTECT] Ignorando ID alienígena o corrompido: ${phone} (${phone.length} dígitos, Original: ${from})`);
                return res.status(200).send('alien_number_ignored');
            }
            // Regla 2: Números de 12-13 dígitos deben empezar con 52 (México)
            // Números de 10 dígitos son locales válidos (sin código de país)
            if (phone.length >= 12 && !phone.startsWith('52')) {
                if (isDebug) console.log(`[WEBHOOK/SPAM-PROTECT] Número no mexicano bloqueado: ${phone} (Original: ${from})`);
                return res.status(200).send('non_mexican_number_ignored');
            }

            if (await isMessageProcessed(msgId)) {
                await logTelemetry('ingress_duplicate', { msgId, from });
                return res.status(200).send('duplicate_ignored');
            }

            // IGNORE OUTGOING MESSAGES
            if (messageData.fromMe || messageData.from_me || mData.key?.fromMe || mData.fromMe) {
                await logTelemetry('ingress_ignored_outgoing', { msgId, from });
                return res.status(200).send('from_me_ignored');
            }

            // IGNORE OLD HISTORICAL MESSAGES (GATEWAY QUEUE SYNC)
            // Cuando GatewayWapp reconecta un código QR, WhatsApp sincroniza mensajes viejos.
            const timestamp = messageData.timestamp;
            if (timestamp) {
                const msgTimeMs = timestamp > 1e11 ? timestamp : timestamp * 1000;
                const nowMs = Date.now();
                const diffMins = (nowMs - msgTimeMs) / 1000 / 60;
                if (diffMins > 5) {
                    if (isDebug) console.log(`[WEBHOOK/SPAM-PROTECT] Ignorando mensaje antiguo de ${phone} (hace ${Math.round(diffMins)} mins) - Sincronización evadida.`);
                    return res.status(200).send('historical_message_ignored');
                }
            }

            await logTelemetry('ingress', {
                msgId,
                from,
                type: messageData.type,
                text: body?.substring(0, 50),
                raw: messageData.__raw || messageData
            });

            try {
                // --- ADMIN COMMANDS ---
                const adminNumber = process.env.ADMIN_NUMBER || '5218116038195';
                const redis = getRedisClient();
                const isAdmin = phone.slice(-10) === adminNumber.slice(-10);

                if (isAdmin) {
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
                        if (isDebug) console.log(`[WEBHOOK/RESET] 💥 Data wiped for candidate ${targetCandId} (${targetPhone}) via WhatsApp command.`);
                        await sendMessage(phone, `✅ *RESET COMPLETADO*\nEl historial y perfil del número \`${targetPhone}\` han sido borrados.\n\nEscribe "Hola" para reiniciar el flujo como un candidato nuevo.`);
                    } else {
                        await sendMessage(phone, `⚠️ *Aviso*: El número \`${targetPhone}\` no existe en la base de datos o ya fue reseteado.`);
                    }
                    return res.status(200).send('reset_processed');
                }

                // --- CANDIDATE LOOKUP ---
                let candidateId = await getCandidateIdByPhone(phone);
                let candidate = null;

                // Move config fetch early to capture instance identifier
                // GatewayWapp may send instanceId at different nesting levels
                const webhookInstanceId = messageData.instanceId || payload.instanceId || payload.instance?.instanceId || req.headers['x-instance-id'];
                const configPromise = getUltraMsgConfig(webhookInstanceId);
                const activeConfig = await configPromise;
                const sourceIdentifier = activeConfig?.identifier || 'whatsapp_v2';
                const capturedInstanceId = activeConfig?.instanceId || webhookInstanceId || null;

                // 🗺️ FAST INSTANCE MAP: Persist phone→instanceId for O(1) messenger lookups
                if (capturedInstanceId) {
                    try {
                        const redis = getRedisClient();
                        if (redis) {
                            // TTL 90 days — refreshed every time they message
                            redis.set(`candidate_instance:${phone}`, capturedInstanceId, 'EX', 7776000).catch(() => {});
                        }
                    } catch (e) { /* non-critical */ }
                }

                if (candidateId) {
                    candidate = await getCandidateById(candidateId);
                    if (!candidate) candidateId = null;
                }

                // 🔄 INSTANCE-SWITCH RESET: If candidate exists but wrote to a DIFFERENT number,
                // deep-delete all their data and start fresh on the new instance.
                // This prevents cross-instance contamination and gives them a clean Brenda flow.
                if (candidate && capturedInstanceId && candidate.instanceId) {
                    // Normalize both IDs for comparison (strip 'instance' prefix)
                    const normalize = (id) => String(id || '').replace(/^instance/, '');
                    const currentNorm = normalize(candidate.instanceId);
                    const incomingNorm = normalize(capturedInstanceId);

                    if (currentNorm && incomingNorm && currentNorm !== incomingNorm) {
                        if (isDebug) console.log(`[WEBHOOK/INSTANCE-SWITCH] 🔄 Candidate ${phone} switched from ${candidate.instanceId} to ${capturedInstanceId}. Performing full reset...`);
                        
                        // Deep delete (same as RESET command): wipes candidate, messages, locks, state keys
                        await deleteCandidate(candidateId);
                        
                        // Clear instance mapping so messenger doesn't use stale data
                        try {
                            const redis = getRedisClient();
                            if (redis) {
                                await redis.del(`candidate_instance:${phone}`).catch(() => {});
                            }
                        } catch (e) { /* non-critical */ }

                        // Nullify so the next block creates a fresh candidate
                        candidateId = null;
                        candidate = null;
                    }
                }

                if (!candidateId) {
                    candidate = await saveCandidate({
                        whatsapp: phone,
                        nombre: messageData.pushname || messageData.pushName || messageData.name || 'Desconocido',
                        origen: sourceIdentifier,
                        instanceId: capturedInstanceId, 
                        esNuevo: 'SI', // Brújula interna: Fase de presentación
                        primerContacto: new Date().toISOString()
                    });
                    candidateId = candidate.id;
                    notifyNewCandidate(candidate).catch(() => { });
                    // 📊 Increment per-instance candidate counter for dashboard
                    if (capturedInstanceId) {
                        try {
                            const redis = getRedisClient();
                            if (redis) redis.incr(`instance_candidates:${capturedInstanceId}`).catch(() => {});
                        } catch (e) { /* non-critical */ }
                    }
                }

                if (isDebug) console.log(`[WEBHOOK] Incoming message from ${phone}: ${body.substring(0, 30)}... [Source: ${sourceIdentifier}]`);

                // --- ADMIN STICKER CAPTURE ---
                let messageType = messageData.type;
                if (!messageType && messageData.message) {
                    if (messageData.message.imageMessage) messageType = 'image';
                    else if (messageData.message.audioMessage) messageType = 'audio';
                    else if (messageData.message.stickerMessage) messageType = 'sticker';
                    else if (messageData.message.reactionMessage) messageType = 'reaction';
                    else messageType = 'text';
                }
                messageType = messageType || 'text';
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

                // --- QUOTE HANDLING ---
                const rawContext = messageData.contextInfo || messageData.message?.extendedTextMessage?.contextInfo || messageData.message?.imageMessage?.contextInfo || messageData.message?.videoMessage?.contextInfo;
                if (rawContext && rawContext.stanzaId) {
                    msgToSave.contextInfo = {
                        quotedMessage: {
                            stanzaId: rawContext.stanzaId,
                            participant: rawContext.participant,
                            // intentamos guardar un texto amigable para mostrar rápido en ui
                            text: rawContext.quotedMessage?.conversation || rawContext.quotedMessage?.extendedTextMessage?.text || (rawContext.quotedMessage?.imageMessage ? '📷 Imagen' : '')
                        }
                    };
                }

                // --- REACTION HANDLING ---
                if (messageType === 'reaction' || messageData.reaction) {
                    const reactionPayload = messageData.reaction || messageData.message?.reactionMessage;
                    if (reactionPayload) {
                        const targetMsgId = reactionPayload.stanzaId || reactionPayload.key?.id;
                        const emoji = reactionPayload.text || '';
                        
                        // Ignoramos si reaccionó a nuestra historia o a un error 
                        if (targetMsgId && candidateId) {
                            await updateMessageReaction(candidateId, targetMsgId, emoji);
                            
                            // Emit a notification (optional, depends on frontend)
                            const redis = getRedisClient();
                            if (redis) {
                                await redis.del('stats:bot:last_calc');
                            }
                        }
                        
                        return res.status(200).send('reaction_processed');
                    }
                }

                if (messageData.media) {
                    msgToSave.mediaUrl = messageData.media;
                }

                // --- PERSISTENCE ---
                // RE-FETCH candidate to prevent concurrent updates (e.g. from recruiter answering in UI) from being overwritten
                const freshCandidate = await getCandidateById(candidateId) || candidate;

                const updatedCandidate = {
                    ...freshCandidate,
                    ultimoMensaje: new Date().toISOString(),
                    lastUserMessageAt: new Date().toISOString(),
                    unreadMsgCount: (Number(freshCandidate?.unreadMsgCount) || 0) + 1,
                    instanceId: capturedInstanceId || freshCandidate?.instanceId // 🔄 DYNAMIC: Respond via the number they just wrote to
                };

                await saveWebhookTransaction({
                    candidateId,
                    message: msgToSave,
                    candidateUpdates: updatedCandidate,
                    eventData: messageData,
                    statsType: 'incoming'
                });
                
                // Force instant SSE stat recalculation so unread badge goes up in realtime
                const redisForCache = getRedisClient();
                if (redisForCache) {
                    await redisForCache.del('stats:bot:last_calc');
                }

                // --- AI PROCESSING (Turbo Mode - Async Queue) ---
                const aiPromise = (async () => {
                    try {
                        const redis = getRedisClient();
                        let isBotActive = await redis?.get('bot_ia_active') !== 'false';
                        
                        try {
                            const rawInstances = await redis?.get('ultramsg_instances');
                            if (rawInstances && capturedInstanceId) {
                                const parsedInsts = JSON.parse(rawInstances);
                                const thisInst = parsedInsts.find(i => i.instanceId === capturedInstanceId);
                                if (thisInst && thisInst.botActive === false) isBotActive = false;
                            }
                        } catch (e) {}

                        if (!isBotActive || candidate?.blocked === true) return;

                        let finalAgentInput = agentInput;

                        // 🔍 CRITICAL DIAGNOSTIC
                        try {
                            await redis.set('DEBUG_AI_PROMISE_INIT', JSON.stringify({
                                messageType,
                                hasMedia: !!messageData.media,
                                mediaUrl: messageData.media || null,
                                phone
                            }));
                        } catch(e) {}

                        // 🎧 AUDIO TRANSCRIPTION (GATEWAY)
                        if ((messageType === 'audio' || messageType === 'ptt' || messageType === 'voice') && messageData.media) {
                            try {
                                // Fetch AI config to get the user's OpenAI API Key
                                const aiConfigStr = await redis?.get('ai_config');
                                const aiConfig = aiConfigStr ? JSON.parse(aiConfigStr) : {};
                                const openAiKey = aiConfig.openaiApiKey || process.env.OPENAI_API_KEY;

                                if (!openAiKey) {
                                    console.error('[WEBHOOK] ❌ No se encontró OpenAI API Key para transcribir el audio.');
                                } else {
                                    if (isDebug) console.log(`[WEBHOOK] 🎙️ Transcribiendo audio de ${phone}: ${messageData.media}`);
                                    const axios = (await import('axios')).default;
                                    const audioRes = await axios.get(messageData.media, { responseType: 'arraybuffer' });
                                    
                                    if (audioRes.status === 200) {
                                        const buffer = Buffer.from(audioRes.data);
                                        
                                        const FormData = (await import('form-data')).default;
                                        const formData = new FormData();
                                        formData.append('file', buffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
                                        formData.append('model', 'whisper-1');
                                        formData.append('language', 'es');
                                        
                                        const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
                                            headers: {
                                                'Authorization': `Bearer ${openAiKey}`,
                                                ...formData.getHeaders()
                                            }
                                        });
                                        
                                        if (whisperRes.data && whisperRes.data.text) {
                                            finalAgentInput = `🎙️ [AUDIO TRANSCRITO]: "${whisperRes.data.text}"`;
                                            if (isDebug) console.log(`[WEBHOOK] 🎙️ Audio transcrito exitosamente: ${whisperRes.data.text}`);
                                        } else {
                                            finalAgentInput = `[DEV-ERR] Whisper no text: ${JSON.stringify(whisperRes.data)}`;
                                        }
                                    } else {
                                        finalAgentInput = `[DEV-ERR] Axios GET failed: HTTP ${audioRes.status}`;
                                    }
                                }
                            } catch (e) {
                                finalAgentInput = `[DEV-ERR] Exception in Whisper Gateway: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`;
                            }

                            // Direct Debug Observability
                            try {
                                await redis.set('debug_last_audio_input', finalAgentInput);
                                await redis.set('debug_last_audio_err_trace', String(finalAgentInput));
                            } catch(e) {}
                        }

                        // 🏁 1. ADD TO WAITLIST (Safe persistence)
                        await addToWaitlist(candidateId, { text: finalAgentInput, msgId });

                        // 🏁 2. SIGNAL TURBO ENGINE DIRECTLY (Keep container alive)
                        if (isDebug) console.log(`[Vercel Turbo] 🚀 Triggering internal engine for candidate ${candidateId}`);

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
                        const url = info?.profile_picture || info?.profilePictureUrl || info?.image || info?.success;
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
