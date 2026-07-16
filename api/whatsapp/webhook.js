/**
 * ═══════════════════════════════════════════════════════════════════
 * 📡 WhatsApp Webhook Handler — Meta Cloud API
 * ═══════════════════════════════════════════════════════════════════
 * Receives webhook events from Meta's WhatsApp Cloud API.
 * Replaces all Baileys/GatewayWapp parsing with Meta's official format.
 * All business logic (admin commands, AI, Brenda, etc.) is preserved.
 * ═══════════════════════════════════════════════════════════════════
 */
import crypto from 'crypto';
import {
    saveMessage,
    getCandidateIdByPhone,
    getCandidateIdByPhoneFast,
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
    updateMessageReaction,
    getRecentMessages
} from '../utils/storage.js';
import { markMessageAsRead, downloadMetaMedia, uploadMediaToMeta } from './utils.js';
import { FEATURES } from '../utils/feature-flags.js';
import { sendMessage } from '../utils/messenger.js';
import { logTelemetry } from '../utils/telemetry.js';
import { sendConversionEvent } from '../utils/metaConversions.js';

// Subido de 60 a 120s: da margen extra a la espera del lock de candidato
// (hasta 50s en workers/process-message.js) + el procesamiento real de IA,
// para que un mensaje no se pierda en silencio si ambos coinciden cerca del limite.
export const maxDuration = 120;

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
        const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
        if (!VERIFY_TOKEN) return res.status(500).send('META_VERIFY_TOKEN no configurado');

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

    // ═══ HMAC-SHA256 SIGNATURE VALIDATION (Meta Cloud API Security) ═══
    // When META_APP_SECRET is configured, validates X-Hub-Signature-256 header
    // to ensure payloads truly originate from Meta. Graceful degradation: if
    // the secret is not set, logs a warning and allows the request through.
    //
    // ⚠️ CRITICAL: Vercel auto-parses JSON bodies. JSON.stringify(req.body)
    //    re-encodes UTF-8 differently than Meta's original payload, breaking
    //    HMAC for accented chars (ó, á, é). We MUST use the raw body bytes.
    const appSecret = process.env.META_APP_SECRET;
    if (appSecret) {
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
            console.error('[META WEBHOOK] ❌ Missing X-Hub-Signature-256 header — rejecting spoofed request');
            return res.status(401).json({ error: 'Missing signature' });
        }

        // Try to get the REAL raw body (Vercel exposes it if bodyParser is off,
        // or via req.rawBody in some runtimes). Fall back to JSON.stringify.
        let rawBody;
        if (typeof req.rawBody === 'string') {
            rawBody = req.rawBody;
        } else if (Buffer.isBuffer(req.rawBody)) {
            rawBody = req.rawBody.toString('utf-8');
        } else if (typeof req.body === 'string') {
            rawBody = req.body;
        } else {
            // Last resort: re-serialize. This may fail for accented characters.
            rawBody = JSON.stringify(req.body);
        }

        const expectedSignature = 'sha256=' + crypto
            .createHmac('sha256', appSecret)
            .update(rawBody, 'utf-8')
            .digest('hex');
        
        // Use try/catch for timingSafeEqual in case lengths differ
        let signatureValid = false;
        try {
            signatureValid = crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            );
        } catch (e) {
            signatureValid = false;
        }

        if (!signatureValid) {
            const hadRawBody = typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody);
            if (hadRawBody) {
                // rawBody disponible y firma incorrecta — rechazar
                return res.status(401).json({ error: 'Invalid webhook signature' });
            }
            // rawBody no disponible (limitación de Vercel sin bodyParser desactivado).
            // TODO: exportar config = { api: { bodyParser: false } } y parsear manualmente.
            if (!global.__metaRawBodyWarned) {
                console.warn('[META WEBHOOK] ⚠️ HMAC no validado — rawBody no disponible. Configura bodyParser: false en Vercel.');
                global.__metaRawBodyWarned = true;
            }
        }
    } else {
        // Log once per cold start to remind ops team to configure the secret
        if (!global.__hmacWarned) {
            console.warn('[META WEBHOOK] ⚠️ META_APP_SECRET not configured — webhook signature validation DISABLED. Add it in Vercel env vars for production security.');
            global.__hmacWarned = true;
        }
    }

    const payload = req.body;

    // ═══ Debug: save raw webhook for inspection (last 50) ═══
    // Fire-and-forget — esto corria en cada webhook (mensajes Y confirmaciones de
    // entrega de Meta) con 3 escrituras awaited de forma bloqueante, sumando latencia
    // real a cada respuesta del bot. El debug logging no necesita bloquear la respuesta.
    try {
        const redis = getRedisClient();
        if (redis) {
            const entry = JSON.stringify({ ts: new Date().toISOString(), payload });
            const debugPipe = redis.pipeline();
            debugPipe.lpush('debug:webhook_history', entry);
            debugPipe.ltrim('debug:webhook_history', 0, 49); // Keep last 50
            debugPipe.set('debug:last_webhook_raw', JSON.stringify(payload));
            debugPipe.exec().catch(() => {});
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

                // 'sent' — skip (frontend ya lo maneja con UI optimista).
                if (statusStr === 'sent') continue;

                // 'delivered'/'read' — prefer exact message id so pending/queued media
                // never jumps straight to blue ticks during ordered sends.
                if ((statusStr === 'delivered' || statusStr === 'read') && recipientPhone.length >= 10) {
                    try {
                        const candidateId = await getCandidateIdByPhoneFast(recipientPhone);
                        if (!candidateId) continue;
                        const { notifyCandidateUpdate } = await import('../utils/sse-notify.js');
                        if (statusStr === 'delivered') {
                            const found = await updateMessageStatus(candidateId, msgId, 'delivered');
                            if (!found) {
                                await notifyCandidateUpdate(candidateId, {
                                    messageStatusUpdate: { id: msgId, status: 'delivered' }
                                });
                            }
                        } else {
                            const found = await updateMessageStatus(candidateId, msgId, 'read');
                            if (!found) {
                                await notifyCandidateUpdate(candidateId, {
                                    messageStatusUpdate: { id: msgId, status: 'read' }
                                });
                            }
                        }
                    } catch (e) { /* silent */ }
                    continue;
                }

                // 'failed' — full persistence (actionable, low volume).
                if (statusStr === 'failed' && recipientPhone.length >= 10) {
                    try {
                        const candidateId = await getCandidateIdByPhone(recipientPhone);
                        if (candidateId) {
                            const metaError = status.errors?.[0];
                            const errorText = metaError
                                ? `Meta Error #${metaError.code}: ${metaError.title || metaError.message || 'Unknown'}`
                                : null;
                            await updateMessageStatus(candidateId, msgId, 'failed', errorText ? { error: errorText } : {});

                            if (metaError) {
                                const redis = getRedisClient();
                                if (redis) {
                                    redis.set('debug:last_meta_failure', JSON.stringify({
                                        timestamp: new Date().toISOString(),
                                        phone: recipientPhone,
                                        msgId,
                                        error: metaError
                                    }), 'EX', 86400).catch(() => {});
                                }
                            }

                            // 131026 = number not on WhatsApp
                            if (metaError?.code === 131026) {
                                await updateCandidate(candidateId, {
                                    status: 'Incontactable',
                                    incontactable: true,
                                    blocked: true
                                });
                            }
                        }
                    } catch (e) { /* silent */ }
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
                case 'contacts':
                    if (metaMsg.contacts?.[0]) {
                        const c = metaMsg.contacts[0];
                        const cName = c.name?.formatted_name || 'Contacto';
                        const cPhone = c.phones?.[0]?.phone || c.phones?.[0]?.wa_id || '';
                        body = `📇 Contacto: ${cName} ${cPhone}`;
                    }
                    messageType = 'contacts';
                    break;
                case 'order':
                    if (metaMsg.order) {
                        const items = metaMsg.order.product_items?.map(i => `${i.product_retailer_id} x${i.quantity}`).join(', ') || 'sin items';
                        body = `🛒 Pedido: ${items}`;
                    }
                    messageType = 'order';
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
                case 'request_welcome':
                    body = 'Que tal! Info sobre la vacante!'; // Fallback para el anuncio
                    messageType = 'text';
                    break;
                default:
                    body = '';
                    messageType = metaMsgType || 'text';
            }

            // ─── META AI FIX: Inject fallback text if hidden by referral ───
            if (!body && metaMsg.referral) {
                const headline = metaMsg.referral.headline || 'un anuncio';
                body = `¡Hola! Vengo de ${headline}. Me gustaría más información.`;
                messageType = 'text';
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
                                    redis.set(key, base64Data, 'EX', 86400), // 24 hours TTL
                                    redis.set(metaKey, JSON.stringify({
                                        mime: mimeType,
                                        filename: `media_${mediaId}`,
                                        size: mediaData.fileSize || base64Data.length,
                                        createdAt: new Date().toISOString(),
                                        blobPath: process.env.BLOB_READ_WRITE_TOKEN ? `media/${id}` : undefined
                                    }), 'EX', 86400 * 365) // registro 1 año (chico); el archivo vive en Blob
                                ]);

                                // 🗄️ Respaldo PERMANENTE a Vercel Blob en el momento de recibirla
                                // (el buffer ya esta en memoria — cero descargas extra). Fire-and-forget:
                                // no bloquea el hot path; /api/image ademas sabe buscar en Blob por
                                // convencion (media/<id>) aunque este put falle o el registro expire.
                                if (process.env.BLOB_READ_WRITE_TOKEN) {
                                    import('@vercel/blob').then(({ put }) =>
                                        put(`media/${id}`, mediaData.buffer, {
                                            access: 'private',
                                            contentType: mimeType,
                                            addRandomSuffix: false
                                        })
                                    ).catch(() => {});
                                }

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

            // ═══════════════════════════════════════════════════════════
            // 🎯 OPERACIÓN 0 FUGAS — Phase 1: Validate + Guarantee
            // ═══════════════════════════════════════════════════════════

            // 🛡️ PHONE VALIDATION (expanded: 10-15 digits, log suspicious)
            if (phone.length < 10) {
                await logTelemetry('ingress_dropped', { reason: 'phone_too_short', phone, length: phone.length });
                continue;
            }
            if (phone.length > 15) {
                await logTelemetry('ingress_dropped', { reason: 'phone_too_long', phone, length: phone.length });
                continue;
            }

            // 🛡️ DEDUP (legitimate — same message shouldn't be saved twice)
            if (await isMessageProcessed(msgId)) {
                continue;
            }

            // 🛡️ IGNORE OLD MESSAGES (expanded: 30 min window, with telemetry)
            if (timestamp) {
                const msgTimeMs = Number(timestamp) > 1e11 ? Number(timestamp) : Number(timestamp) * 1000;
                const diffMins = (Date.now() - msgTimeMs) / 1000 / 60;
                if (diffMins > 30) {
                    await logTelemetry('ingress_dropped', { reason: 'stale_message', phone, diffMins: Math.round(diffMins) });
                    await markMessageAsDone(msgId);
                    continue;
                }
            }

            // ═══════════════════════════════════════════════════════════
            // 🎯 CANDIDATE GUARANTEE — Candidato se crea SIEMPRE aquí
            // ═══════════════════════════════════════════════════════════
            const redis = getRedisClient();
            let candidateId = await getCandidateIdByPhone(phone);
            let candidate = null;
            let isNewCandidate = false;

            if (candidateId) {
                candidate = await getCandidateById(candidateId);
                if (!candidate) candidateId = null;
            }

            if (!candidateId) {
                const referral = metaMsg?.referral;
                candidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: pushName,
                    origen: referral ? 'facebook_ctwa' : 'meta_cloud_api',
                    esNuevo: 'SI',
                    primerContacto: new Date().toISOString(),
                    ...(referral && {
                        // Solo guardamos lo que realmente se usa: adId (etiquetas), adHeadline
                        // y adClickId (conversiones Meta), + adSource/adMediaType (metadata chica).
                        // adBody/adImageUrl/adVideoUrl/adUrl NO se guardan: pesaban ~61% del blob
                        // del candidato y no se usan para nada (solo id + etiqueta). Ver medidor de
                        // ancho de banda — eran la mayor fuga de lectura de candidate:*.
                        adClickId: referral.ctwa_clid || null,
                        adSource: referral.source_type || null,
                        adId: referral.source_id || null,
                        adHeadline: referral.headline || null,
                        adMediaType: referral.media_type || null,
                    })
                });
                candidateId = candidate.id;
                isNewCandidate = true;

                // 🖼️ Creativo del anuncio (foto/texto) guardado UNA vez por adId — para
                // Estadisticas Ads, fuera del blob del candidato (que ya no lo trae). NX =
                // solo el primer candidato de cada anuncio lo establece.
                if (referral && candidate.adId && (referral.image_url || referral.body || referral.video_url)) {
                    redis.set(`ad_creative:${candidate.adId}`, JSON.stringify({
                        adImageUrl: referral.image_url || null,
                        adBody: referral.body || null,
                        adUrl: referral.source_url || null,
                        adHeadline: referral.headline || null,
                        adMediaType: referral.media_type || null,
                        adVideoUrl: referral.video_url || null
                    }), 'NX').catch(() => {});
                }

                // 🏷️ Auto-apply Ad Labels before AI runs so the first reply has ad/company context.
                if (candidate.adId) {
                    try {
                        const redis = getRedisClient();
                        const rawLabels = redis ? await redis.get('candidatic:ad_labels') : null;
                        const adLabels = rawLabels ? JSON.parse(rawLabels) : [];
                        const candAdId = String(candidate.adId);
                        const matching = adLabels.filter(l => {
                            const ids = l.adIds || (l.adId ? [l.adId] : []);
                            return ids.map(String).includes(candAdId);
                        });
                        if (matching.length > 0) {
                            const existingTags = Array.isArray(candidate.tags) ? candidate.tags : [];
                            const newTags = [...existingTags];
                            let changed = false;
                            for (const l of matching) {
                                if (!newTags.includes(l.tagName)) { newTags.push(l.tagName); changed = true; }
                            }
                            if (changed) {
                                candidate = await updateCandidate(candidate.id, { tags: newTags });
                            }
                        }
                    } catch(e) { /* silent */ }
                }

                // 📊 Meta Conversions API — Lead event for CTWA ad candidates
                if (candidate.adClickId) {
                    sendConversionEvent({
                        eventName: 'Lead',
                        phone,
                        ctwaClid: candidate.adClickId,
                        customData: {
                            ...(candidate.adId && { ad_id: candidate.adId }),
                            ...(candidate.adHeadline && { ad_title: candidate.adHeadline }),
                        }
                    }).catch(() => {});
                }
            }

            // ═══════════════════════════════════════════════════════════
            // 🎯 MESSAGE PERSISTENCE — Mensaje se guarda SIEMPRE aquí
            // ═══════════════════════════════════════════════════════════
            const msgToSave = {
                id: msgId, from: 'user', content: body,
                type: messageType, timestamp: new Date().toISOString(),
                ...(mediaUrl && { mediaUrl })
            };
            if (metaMsg.context?.id) {
                // Igual que en el envío manual (api/chat.js): guardar el TEXTO citado aquí,
                // no solo el id — así la vista previa de "respondiendo a..." no depende de
                // que el mensaje original siga en el historial cargado en el navegador.
                let quotedText = '';
                let quotedMediaUrl = '';
                let quotedType = '';
                try {
                    const recentForQuote = await getRecentMessages(candidateId, 50);
                    const quoted = recentForQuote.find(m => m.id === metaMsg.context.id || m.ultraMsgId === metaMsg.context.id);
                    if (quoted?.content) quotedText = String(quoted.content).replace(/<[^>]*>?/gm, '').trim().slice(0, 200);
                    // Sin texto: guardar tambien mediaUrl/type para que la preview pueda
                    // mostrar una miniatura ("📷 Foto") en vez del generico "Mensaje multimedia".
                    if (!quotedText && quoted?.mediaUrl) { quotedMediaUrl = quoted.mediaUrl; quotedType = quoted.type || ''; }
                    // Fallback: los mensajes del bot se guardan en el historial sin su wamid,
                    // asi que la busqueda por id falla para ellos. El envio (sendMetaMessage)
                    // deja un mapeo wamid:text:<id> → texto con TTL de 72h — usarlo aqui.
                    if (!quotedText && !quotedMediaUrl && redis) {
                        const srcText = await redis.get(`wamid:text:${metaMsg.context.id}`).catch(() => null);
                        if (srcText) quotedText = String(srcText).replace(/<[^>]*>?/gm, '').trim().slice(0, 200);
                    }
                } catch { /* best-effort: si falla, la preview cae al texto generico */ }
                msgToSave.contextInfo = { quotedMessage: { stanzaId: metaMsg.context.id, participant: metaMsg.context.from || '', text: quotedText, ...(quotedMediaUrl && { mediaUrl: quotedMediaUrl, type: quotedType }) } };
            }

            // Reaction is special — update reaction on existing message, don't save new
            if (metaMsgType === 'reaction' && metaMsg.reaction) {
                const targetMsgId = metaMsg.reaction.message_id;
                if (targetMsgId && candidateId) {
                    await updateMessageReaction(candidateId, targetMsgId, metaMsg.reaction.emoji || '');
                    if (redis) await redis.del('stats:bot:last_calc');
                }
                await markMessageAsDone(msgId);
                continue; // Reactions don't need AI processing
            }

            const freshCandidate = await getCandidateById(candidateId) || candidate;
            const updatedCandidate = {
                ...freshCandidate,
                ultimoMensaje: new Date().toISOString(),
                lastUserMessageAt: new Date().toISOString(),
                unreadMsgCount: (Number(freshCandidate?.unreadMsgCount) || 0) + 1,
                mensajesTotales: (Number(freshCandidate?.mensajesTotales) || 0) + 1,
                // Guardar qué número de la empresa recibió este mensaje para responder desde el mismo
                incomingPhoneNumberId: metadata?.phone_number_id || process.env.META_PHONE_NUMBER_ID
            };

            // ─── META AI RETARGETING FIX: Update referral for existing candidates ───
            if (metaMsg.referral) {
                updatedCandidate.origen = 'facebook_ctwa';
                if (metaMsg.referral.source_id) updatedCandidate.adId = metaMsg.referral.source_id;
                if (metaMsg.referral.headline) updatedCandidate.adHeadline = metaMsg.referral.headline;
                if (metaMsg.referral.source_type) updatedCandidate.adSource = metaMsg.referral.source_type;
                if (metaMsg.referral.ctwa_clid) updatedCandidate.adClickId = metaMsg.referral.ctwa_clid;
                // adUrl/adBody/adImageUrl no se guardan (bytes pesados no usados) — ver bloque de creacion arriba.

                // Guarda el creativo del anuncio (foto/texto) una vez por adId, tambien para
                // candidatos existentes que vuelven desde un anuncio (por si aun no existia).
                if (updatedCandidate.adId && (metaMsg.referral.image_url || metaMsg.referral.body || metaMsg.referral.video_url)) {
                    redis.set(`ad_creative:${updatedCandidate.adId}`, JSON.stringify({
                        adImageUrl: metaMsg.referral.image_url || null,
                        adBody: metaMsg.referral.body || null,
                        adUrl: metaMsg.referral.source_url || null,
                        adHeadline: metaMsg.referral.headline || null,
                        adMediaType: metaMsg.referral.media_type || null,
                        adVideoUrl: metaMsg.referral.video_url || null
                    }), 'NX').catch(() => {});
                }

                // 🏷️ Re-aplica etiquetas de anuncio a candidatos EXISTENTES que vuelven desde
                // un anuncio (retargeting, o regla agregada despues de su creacion). Antes el
                // auto-etiquetado solo corria al CREAR el candidato — por eso los que regresaban
                // se quedaban sin la etiqueta. Solo AGREGA, nunca quita.
                if (updatedCandidate.adId) {
                    try {
                        const rawLabels = await redis.get('candidatic:ad_labels');
                        const adLabels = rawLabels ? JSON.parse(rawLabels) : [];
                        const candAdId = String(updatedCandidate.adId);
                        const matching = adLabels.filter(l => (l.adIds || (l.adId ? [l.adId] : [])).map(String).includes(candAdId));
                        if (matching.length > 0) {
                            const tags = Array.isArray(updatedCandidate.tags) ? [...updatedCandidate.tags] : [];
                            for (const l of matching) if (!tags.includes(l.tagName)) tags.push(l.tagName);
                            updatedCandidate.tags = tags;
                        }
                    } catch { /* silent */ }
                }
            }

            const previousUserTime = freshCandidate?.lastUserMessageAt ? new Date(freshCandidate.lastUserMessageAt).getTime() : 0;
            const previousHumanTime = freshCandidate?.lastHumanMessageAt ? new Date(freshCandidate.lastHumanMessageAt).getTime() : 0;
            const wasUnread = !!previousUserTime && previousUserTime > previousHumanTime;
            if (redis) {
                await redis.sadd('candidates:unread', candidateId).catch(() => {});
                if (!wasUnread) {
                    await redis.incr('stats:bot:unread_v2').catch(() => {});
                    await redis.incr('stats:unread:version').catch(() => {});
                }
            }

            await saveWebhookTransaction({
                candidateId, message: msgToSave,
                candidateUpdates: updatedCandidate,
                eventData: metaMsg, statsType: 'incoming'
            });
            await markMessageAsDone(msgId);
            if (redis) await redis.del('stats:bot:last_calc');

            const globalBotSetting = redis ? await redis.get('bot_ia_active').catch(() => null) : null;
            const isBotGloballyActive = globalBotSetting !== 'false';
            const shouldAutoReadIncoming = freshCandidate?.blocked !== true && isBotGloballyActive;
            if (shouldAutoReadIncoming) {
                // Bot activo: el candidato ve azul inmediato porque la IA sí está atendiendo.
                // Esto no toca el contador interno de no leídos; sólo manda el read receipt a Meta.
                await markMessageAsRead(msgId, metadata?.phone_number_id).catch(() => {});
            }

            await logTelemetry('ingress_captured', {
                msgId, from: phone, type: messageType, isNew: isNewCandidate,
                text: body?.substring(0, 50)
            });

            try {
                // ═══════════════════════════════════════════════════════════
                // 🎯 OPERACIÓN 0 FUGAS — Phase 2: Business Logic
                // (Candidato + mensaje YA están guardados. Los continue
                //  aquí solo saltan la IA, NO pierden datos.)
                // ═══════════════════════════════════════════════════════════
                const adminNumber = process.env.ADMIN_NUMBER || '5218116038195';
                const isAdmin = phone.slice(-10) === adminNumber.slice(-10);
                // Wrapper: responde desde el mismo número que recibió el comando
                const _cmdPhoneId = metadata?.phone_number_id;
                const sendCmd = (to, msg, type = 'chat', extra = {}) =>
                    sendMessage(to, msg, type, { ...extra, phoneNumberId: _cmdPhoneId });

                // ── PUBLIC COMMANDS (any number) ──
                const lowerBodyPublic = body.toLowerCase().trim();
                if (lowerBodyPublic === 'candidatos nuevos') {
                    try {
                        // Get today's start/end timestamps in Monterrey timezone
                        const now = new Date();
                        const mtyFormatter = new Intl.DateTimeFormat('en-CA', {
                            timeZone: 'America/Monterrey',
                            year: 'numeric', month: '2-digit', day: '2-digit'
                        });
                        const todayStr = mtyFormatter.format(now); // YYYY-MM-DD

                        // Calculate start-of-day in Monterrey → UTC timestamp
                        const todayStartUTC = new Date(`${todayStr}T00:00:00-06:00`).getTime();
                        const todayEndUTC = new Date(`${todayStr}T23:59:59-06:00`).getTime();

                        // Fetch only candidates with score (ultimoMensaje) within today
                        const ids = await redis.zrangebyscore('candidates:list', todayStartUTC, todayEndUTC);

                        let countToday = 0;
                        let countBot = 0;
                        let countManual = 0;

                        if (ids && ids.length > 0) {
                            // Load candidate data in pipeline
                            const pipeline = redis.pipeline();
                            ids.forEach(id => pipeline.get(`candidate:${id}`));
                            const results = await pipeline.exec();

                            for (const [err, res] of results) {
                                if (err || !res) continue;
                                try {
                                    const c = JSON.parse(res);
                                    const created = c.primerContacto;
                                    if (!created) continue;
                                    // Verify primerContacto is actually today (score is ultimoMensaje)
                                    const cDate = mtyFormatter.format(new Date(created));
                                    if (cDate === todayStr) {
                                        countToday++;
                                        const isManual = c.source === 'manual' || c.source === 'web' 
                                            || (c.origen && (c.origen.includes('manual') || c.origen === 'web'));
                                        if (isManual) {
                                            countManual++;
                                        } else {
                                            countBot++;
                                        }
                                    }
                                } catch (e) {}
                            }
                        }

                        const timeStr = now.toLocaleTimeString('es-MX', { timeZone: 'America/Monterrey', hour: '2-digit', minute: '2-digit' });
                        await sendCmd(phone,
                            `📊 *Candidatos Nuevos Hoy*\n` +
                            `📅 ${todayStr} (${timeStr} MTY)\n\n` +
                            `👥 *Total:* ${countToday}\n` +
                            `🤖 Por Bot: ${countBot}\n` +
                            `✍️ Manuales: ${countManual}`
                        );
                    } catch (e) {
                        console.error('Error in CANDIDATOS NUEVOS command:', e);
                        await sendCmd(phone, '❌ Error al consultar candidatos. Intenta de nuevo.');
                    }
                    continue;
                }

                if (lowerBodyPublic === 'candidatos nuevos de ayer') {
                    try {
                        const now = new Date();
                        const mtyFormatter = new Intl.DateTimeFormat('en-CA', {
                            timeZone: 'America/Monterrey',
                            year: 'numeric', month: '2-digit', day: '2-digit'
                        });

                        // Get yesterday's date in Monterrey timezone
                        const yesterdayDate = new Date(now);
                        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                        // Format in Monterrey timezone to handle DST correctly
                        const yesterdayStr = mtyFormatter.format(yesterdayDate); // YYYY-MM-DD

                        // Calculate yesterday start/end in UTC
                        const yesterdayStartUTC = new Date(`${yesterdayStr}T00:00:00-06:00`).getTime();
                        const yesterdayEndUTC = new Date(`${yesterdayStr}T23:59:59-06:00`).getTime();

                        // Fetch candidates with score (ultimoMensaje) within yesterday
                        const ids = await redis.zrangebyscore('candidates:list', yesterdayStartUTC, yesterdayEndUTC);

                        let countYesterday = 0;
                        let countBot = 0;
                        let countManual = 0;

                        if (ids && ids.length > 0) {
                            const pipeline = redis.pipeline();
                            ids.forEach(id => pipeline.get(`candidate:${id}`));
                            const results = await pipeline.exec();

                            for (const [err, res] of results) {
                                if (err || !res) continue;
                                try {
                                    const c = JSON.parse(res);
                                    const created = c.primerContacto;
                                    if (!created) continue;
                                    // Verify primerContacto is actually yesterday
                                    const cDate = mtyFormatter.format(new Date(created));
                                    if (cDate === yesterdayStr) {
                                        countYesterday++;
                                        const isManual = c.source === 'manual' || c.source === 'web' 
                                            || (c.origen && (c.origen.includes('manual') || c.origen === 'web'));
                                        if (isManual) {
                                            countManual++;
                                        } else {
                                            countBot++;
                                        }
                                    }
                                } catch (e) {}
                            }
                        }

                        const timeStr = now.toLocaleTimeString('es-MX', { timeZone: 'America/Monterrey', hour: '2-digit', minute: '2-digit' });
                        await sendCmd(phone,
                            `📊 *Candidatos Nuevos de Ayer*\n` +
                            `📅 ${yesterdayStr} (día completo)\n\n` +
                            `👥 *Total:* ${countYesterday}\n` +
                            `🤖 Por Bot: ${countBot}\n` +
                            `✍️ Manuales: ${countManual}`
                        );
                    } catch (e) {
                        console.error('Error in CANDIDATOS NUEVOS DE AYER command:', e);
                        await sendCmd(phone, '❌ Error al consultar candidatos de ayer. Intenta de nuevo.');
                    }
                    continue;
                }

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
                        },
                        'aprender puente cierre paso2': {
                            key: 'bot_paso2_sticker',
                            label: 'Cierre Paso 2 (cuando el candidato termina colonia + experiencia)'
                        },
                        'puente paso2': {
                            key: 'bot_paso2_sticker',
                            label: 'Cierre Paso 2 (cuando el candidato termina colonia + experiencia)'
                        }
                    };

                    const matchedCommand = Object.keys(BRIDGE_COMMANDS).find(cmd => lowerBody.includes(cmd));
                    if (matchedCommand) {
                        const { key, label } = BRIDGE_COMMANDS[matchedCommand];
                        await redis.set(`admin_state:${phone}`, `waiting_bridge_sticker:${key}`);
                        await sendCmd(adminNumber, `✅ Listo. Ahora mándame el *STICKER* que quieres usar como puente para:\n\n🎯 *${label}*\n\nEspero tu sticker... 🌸`);
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

                            await sendCmd(adminNumber, `${bridge.label}\n📌 ${bridge.desc}\n${stickerUrl ? '✅ Configurado' : '❌ Sin configurar aún'}`);
                            if (stickerUrl) {
                                await sendCmd(adminNumber, stickerUrl, 'sticker', { mediaId: metaMediaId });
                                anyFound = true;
                            }
                        }
                        if (!anyFound) await sendCmd(adminNumber, '⚠️ Ningún puente configurado todavía. Usa los comandos *APRENDER PUENTE...* para enseñarle a Brenda.');
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
                                    await sendCmd(adminNumber, `✅ Usuario ${user.name} (${targetPhone}) activado con éxito.`);
                                    await sendCmd(user.whatsapp, `🎉 ¡Felicidades ${user.name}! Tu cuenta ha sido activada. Ya puedes iniciar sesión en Candidatic IA. 🚀`);
                                    continue;
                                } else {
                                    await sendCmd(adminNumber, `❌ No encontré ningún usuario pendiente con el número ${targetPhone}.`);
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

                // [REMOVED] Pending-user gatekeeper — team members must be able to
                // test the candidate flow with Brenda regardless of their user status.

                // ── 🌪️ RESET COMMAND INTERCEPTOR ──
                const upperBody = body?.toUpperCase().trim() || '';

                // ── 🔐 APP LOGIN INTERCEPTOR (BOLSA DE EMPLEO) ──
                if (upperBody.includes('SOLICITAR PIN DE ACCESO')) {
                    const redis = getRedisClient();
                    if (redis) {
                        const pin = Math.floor(1000 + Math.random() * 9000).toString();
                        await redis.set(`app_login_pin:${phone}`, pin, 'EX', 600);
                        await sendCmd(phone, `👋 ¡Hola!\n\nTu PIN de acceso para la app de Candidatic es: *${pin}*\n\nEste código expirará en 10 minutos. 🔐`);
                    }
                    continue; // Detener propagación para no activar IA ni guardar mensaje
                }

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
                        await sendCmd(phone, `✅ *RESET COMPLETADO*\nEl historial y perfil del número \`${targetPhone}\` han sido borrados.\n\nEscribe "Hola" para reiniciar el flujo como un candidato nuevo.`);
                    } else {
                        await sendCmd(phone, `⚠️ *Aviso*: El número \`${targetPhone}\` no existe en la base de datos o ya fue reseteado.`);
                    }
                    continue;
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
                            'bot_bridge_exit': 'No Interesa',
                            'bot_paso2_sticker': 'Cierre Paso 2'
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

                        // 🔒 Make the sticker buffer PERMANENT (remove 48h TTL)
                        // so bridge stickers never expire from Redis
                        try {
                            const imageId = mediaUrl.split('?id=')[1];
                            if (imageId) {
                                await redis.persist(`image:${imageId}`);
                                await redis.persist(`meta:image:${imageId}`);
                            }
                        } catch (e) {}

                        await sendCmd(adminNumber, `✅ ¡Puente *"${label}"* guardado con éxito! 🚀\n\nClave: \`${redisKey}\`\n♾️ Sticker guardado permanentemente.`);
                        continue;
                    }
                    // If not waiting for a bridge sticker, fall through and treat as normal candidate message
                }

                // ── DEV SCREENSHOT CAPTURE ──
                if (phone.slice(-10) === adminNumber.slice(-10) && (messageType === 'image' || messageType === 'video' || messageType === 'document')) {
                    if (mediaUrl && body?.toLowerCase().includes('screen')) {
                        await redis.set('dev_last_screenshot', mediaUrl, 'EX', 86400);
                        await sendCmd(adminNumber, `📸 Screenshot guardado. La IA puede consultarlo ahora.`);
                        continue;
                    }
                }

                // ═══ AI PROCESSING (Turbo Mode) ═══
                const agentInput = body;
                const aiPromise = (async () => {
                    try {
                        let isBotActive = isBotGloballyActive;

                        const aiCandidate = await getCandidateById(candidateId) || candidate;
                        if (!isBotActive || aiCandidate?.blocked === true) return;

                        let finalAgentInput = agentInput;

                        // 🎙️ AUDIO → Disclaimer determinístico + agente retoma pregunta pendiente
                        if (messageType === 'audio' || messageType === 'ptt') {
                            const AUDIO_REPLIES = [
                                '¡Hola! 😊 Por el momento no puedo escuchar audios. ¿Me podrías escribir tu mensaje? 📝 ¡Con mucho gusto te atiendo!',
                                '¡Qué tal! 👋 Te cuento que no tengo forma de reproducir notas de voz. Escríbeme por favor y te respondo de inmediato ✍️😊',
                                '¡Hola! 🌟 Recibí tu audio pero no me es posible escucharlo. ¿Podrías escribirme lo que necesitas? Estoy aquí para ayudarte 😄',
                                '¡Hey! 😊 Lo siento, los mensajes de voz no los puedo reproducir. Te pido de favor que me escribas tu mensaje 📝 ¡Gracias!',
                                '¡Hola! 🙌 Lamentablemente no puedo escuchar audios en este momento. Escríbeme y con mucho gusto te oriento 😊✍️',
                                '¡Buenas! 🌸 Recibí tu nota de voz pero no tengo manera de escucharla. ¿Me escribes lo que necesitas? ¡Estoy lista para ayudarte! 😄',
                                '¡Hola! 🎉 Para poder ayudarte mejor, ¿podrías escribirme tu mensaje? Los audios no los puedo escuchar 🙏 ¡Gracias por entender!',
                                '¡Hey! 💬 No me es posible reproducir audios. Escríbeme con confianza y te atiendo enseguida 😊✨',
                                '¡Hola! 😄 Te comento que los mensajes de voz no los puedo escuchar. ¿Podrías escribirme? ¡Con gusto te ayudo con lo que necesites! 🌟',
                                '¡Qué tal! 😊 Ay, los audios no los puedo escuchar por el momento 😅 ¿Me escribes tu mensaje? Así te atiendo mucho mejor ✍️🙌',
                            ];
                            const disclaimer = AUDIO_REPLIES[Math.floor(Math.random() * AUDIO_REPLIES.length)];
                            try {
                                const { sendUltraMsgMessage, getUltraMsgConfig: _getConfig } = await import('./utils.js');
                                const cleanTo = aiCandidate.whatsapp.replace(/\D/g, '');
                                const ultraConfig = await _getConfig(aiCandidate.incomingPhoneNumberId || aiCandidate.instanceId);
                                await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, disclaimer, 'chat', {});
                                const disclaimerMsg = {
                                    id: `msg_${Date.now()}_audio_reply`,
                                    from: 'bot',
                                    content: disclaimer,
                                    type: 'text',
                                    status: 'sent',
                                    timestamp: new Date().toISOString(),
                                };
                                await saveMessage(candidateId, disclaimerMsg);
                                const { notifyCandidateUpdate } = await import('../utils/sse-notify.js');
                                await notifyCandidateUpdate(candidateId, { newMessage: true, messagePayload: disclaimerMsg });
                            } catch (e) {
                                console.error('❌ Audio disclaimer error:', e.message);
                            }

                            // Buscar la última pregunta real del bot ANTES del disclaimer
                            // para que el agente la repita exacta, no adivine
                            let lastBotQuestion = '';
                            try {
                                const rawMsgs = await redis.lrange(`messages:${candidateId}`, 0, -1);
                                const parsed = rawMsgs.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
                                // Buscar hacia atrás el último mensaje del bot que NO sea el disclaimer que acabamos de mandar
                                const lastBot = [...parsed].reverse().find(m =>
                                    (m.from === 'bot' || m.from === 'me') && m.content !== disclaimer
                                );
                                lastBotQuestion = lastBot?.content || '';
                            } catch (e) { /* silent */ }

                            if (lastBotQuestion) {
                                finalAgentInput = `[El candidato mandó un audio. Ya le dijiste que no puedes escuchar audios (en el mensaje anterior). NO menciones el audio ni el disclaimer. Tu última pregunta fue exactamente esta: "${lastBotQuestion}" — repítela de forma natural como si continuaras el hilo, sin cambiar el tema.]`;
                            } else {
                                finalAgentInput = '[El candidato mandó un audio. Ya le avisaste que no puedes escuchar audios. Continúa la conversación de forma natural retomando donde quedaste.]';
                            }
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
