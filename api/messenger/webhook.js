/**
 * ═══════════════════════════════════════════════════════════════════
 * 💬 MESSENGER WEBHOOK — Facebook Messenger Platform
 * ═══════════════════════════════════════════════════════════════════
 * Receives webhook events from Facebook Messenger.
 * Mirrors the WhatsApp webhook architecture:
 *   1. Validate & dedup
 *   2. Guarantee candidate creation
 *   3. Guarantee message persistence
 *   4. Dispatch to AI (Brenda / Turbo Engine)
 *
 * Messenger payload format:
 *   { object: "page", entry: [{ messaging: [{ sender, recipient, message, ... }] }] }
 * ═══════════════════════════════════════════════════════════════════
 */
import crypto from 'crypto';
import {
    getCandidateById,
    saveCandidate,
    updateCandidate,
    getRedisClient,
    isMessageProcessed,
    unlockMessage,
    addToWaitlist,
    saveWebhookTransaction,
    markMessageAsDone
} from '../utils/storage.js';
import { getMessengerProfile, markMessengerMessageAsRead } from './utils.js';
import { logTelemetry } from '../utils/telemetry.js';

// Subido de 60 a 120s — mismo motivo que api/whatsapp/webhook.js: margen extra
// para la espera de lock + procesamiento de IA antes de que Vercel mate la funcion.
export const maxDuration = 120;

const isDebug = process.env.DEBUG_MODE === 'true';
if (!isDebug) {
    console.log = function () { };
}

/**
 * Look up a candidate by their Messenger PSID.
 * Uses a dedicated Redis hash index: messenger_psid_index
 */
const getCandidateIdByPSID = async (psid) => {
    if (!psid) return null;
    const client = getRedisClient();
    if (!client) return null;

    try {
        return await client.hget('messenger:psid_index', psid);
    } catch (e) {
        return null;
    }
};

/**
 * Index a candidate by PSID for O(1) lookups.
 */
const indexPSID = async (psid, candidateId) => {
    if (!psid || !candidateId) return;
    const client = getRedisClient();
    if (!client) return;

    try {
        await client.hset('messenger:psid_index', psid, candidateId);
    } catch (e) {
        console.error('[Messenger Webhook] ❌ PSID index error:', e.message);
    }
};

export default async function handler(req, res) {
    // ═══ WEBHOOK VERIFICATION (GET) ═══
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
        if (!VERIFY_TOKEN) return res.status(500).send('META_VERIFY_TOKEN no configurado');

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('[MESSENGER WEBHOOK] ✅ Verification successful');
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ═══ HMAC Signature Validation ═══
    const appSecret = process.env.META_APP_SECRET;
    if (appSecret) {
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) return res.status(401).json({ error: 'Missing signature' });
        const rawBody = typeof req.rawBody === 'string' ? req.rawBody
            : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf-8')
            : JSON.stringify(req.body);
        const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf-8').digest('hex');
        let valid = false;
        try { valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { valid = false; }
        if (!valid) {
            const hadRawBody = typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody);
            if (hadRawBody) return res.status(401).json({ error: 'Invalid webhook signature' });
            console.warn('[MESSENGER WEBHOOK] ⚠️ HMAC no validado — rawBody no disponible.');
        }
    }

    const payload = req.body;

    // ═══ Debug: save raw webhook ═══
    try {
        const redis = getRedisClient();
        if (redis) {
            const entry = JSON.stringify({ ts: new Date().toISOString(), platform: 'messenger', payload });
            await redis.lpush('debug:messenger_webhook_history', entry);
            await redis.ltrim('debug:messenger_webhook_history', 0, 49);
        }
    } catch (e) { }

    // ═══ MESSENGER PAYLOAD VALIDATION ═══
    // Messenger sends: { object: "page", entry: [{ messaging: [...] }] }
    if (payload.object !== 'page') {
        return res.status(200).send('not_page');
    }

    const entries = payload.entry;
    if (!entries || entries.length === 0) {
        return res.status(200).send('no_entries');
    }

    try {
        for (const entry of entries) {
            const messagingEvents = entry.messaging;
            if (!messagingEvents || messagingEvents.length === 0) continue;

            for (const event of messagingEvents) {
                const senderPSID = event.sender?.id;
                const recipientPageId = event.recipient?.id;
                const timestamp = event.timestamp;

                if (!senderPSID) continue;

                // Skip messages sent BY the page (echoes)
                const pageId = process.env.META_PAGE_ID || recipientPageId;
                if (senderPSID === pageId) continue;

                // ════════════════════════════════════════════════
                // Handle Messaging Events
                // ════════════════════════════════════════════════

                // --- Postbacks (button taps) ---
                if (event.postback) {
                    const body = event.postback.title || event.postback.payload || '';
                    await processMessengerMessage(senderPSID, {
                        mid: `pb_${senderPSID}_${timestamp}`,
                        text: body
                    }, timestamp, event.referral);
                    continue;
                }

                // --- Regular messages ---
                if (event.message) {
                    // Skip echoes (messages sent by the page itself)
                    if (event.message.is_echo) continue;

                    await processMessengerMessage(senderPSID, event.message, timestamp, event.referral);
                    continue;
                }

                // --- Referrals (m.me links, ads) ---
                if (event.referral && !event.message && !event.postback) {
                    const ref = event.referral;
                    const body = ref.ref || `Vengo de ${ref.source || 'Facebook'}`;
                    await processMessengerMessage(senderPSID, {
                        mid: `ref_${senderPSID}_${timestamp}`,
                        text: body
                    }, timestamp, ref);
                    continue;
                }
            }
        }

        return res.status(200).send('EVENT_RECEIVED');

    } catch (error) {
        console.error('[Messenger Webhook] ❌ Fatal:', error);
        await logTelemetry('messenger_fatal', { error: error.message });
        return res.status(200).send('error_handled');
    }
}

/**
 * Process a single Messenger message — mirrors WhatsApp webhook logic exactly.
 */
async function processMessengerMessage(psid, message, timestamp, referral) {
    const msgId = message.mid || `msg_${psid}_${Date.now()}`;

    try {
        // ─── Extract message content ───
        let body = '';
        let messageType = 'text';
        let mediaUrl = null;

        if (message.text) {
            body = message.text;
            messageType = 'text';
        } else if (message.attachments && message.attachments.length > 0) {
            const attachment = message.attachments[0];
            const aType = attachment.type; // image, video, audio, file, location, fallback

            switch (aType) {
                case 'image':
                    mediaUrl = attachment.payload?.url;
                    messageType = 'image';
                    break;
                case 'video':
                    mediaUrl = attachment.payload?.url;
                    messageType = 'video';
                    break;
                case 'audio':
                    mediaUrl = attachment.payload?.url;
                    messageType = 'audio';
                    break;
                case 'file':
                    mediaUrl = attachment.payload?.url;
                    messageType = 'document';
                    break;
                case 'location':
                    body = `📍 Ubicación: ${attachment.payload?.coordinates?.lat}, ${attachment.payload?.coordinates?.long}`;
                    messageType = 'location';
                    break;
                default:
                    body = message.text || '[Contenido no soportado]';
                    messageType = 'text';
            }
        }

        // Quick replies
        if (message.quick_reply?.payload) {
            body = message.quick_reply.payload;
            messageType = 'text';
        }

        // Fallback: if no body and no media, skip
        if (!body && !mediaUrl) {
            body = '[Mensaje sin contenido]';
        }

        // ─── DEDUP ───
        if (await isMessageProcessed(msgId)) {
            return;
        }

        // ─── STALE MESSAGE FILTER (30 min) ───
        if (timestamp) {
            const msgTimeMs = Number(timestamp) > 1e11 ? Number(timestamp) : Number(timestamp) * 1000;
            const diffMins = (Date.now() - msgTimeMs) / 1000 / 60;
            if (diffMins > 30) {
                await logTelemetry('messenger_stale', { psid, diffMins: Math.round(diffMins) });
                await markMessageAsDone(msgId);
                return;
            }
        }

        // ═══════════════════════════════════════════════════════════
        // 🎯 CANDIDATE GUARANTEE — Candidate is ALWAYS created here
        // ═══════════════════════════════════════════════════════════
        const redis = getRedisClient();
        let candidateId = await getCandidateIdByPSID(psid);
        let candidate = null;
        let isNewCandidate = false;

        if (candidateId) {
            candidate = await getCandidateById(candidateId);
            if (!candidate) candidateId = null;
            // Auto-fix: update name/pic if still default
            if (candidate && (!candidate.nombre || candidate.nombre === 'Usuario Messenger' || candidate.nombre === 'Usuario de Messenger')) {
                const profile = await getMessengerProfile(psid);
                if (profile?.fullName) {
                    console.error(`[Messenger] Updating name for ${psid}: ${profile.fullName}`);
                    await updateCandidate(candidateId, {
                        nombre: profile.fullName,
                        nombreReal: profile.fullName,
                        ...(profile.profilePic && { profilePic: profile.profilePic })
                    });
                    candidate = await getCandidateById(candidateId);
                }
            }
        }

        if (!candidateId) {
            // Fetch profile from Facebook
            const profile = await getMessengerProfile(psid);
            console.error(`[Messenger] Profile for ${psid}:`, profile ? `${profile.fullName} ✅` : '❌ null (token/permissions issue?)');

            candidate = await saveCandidate({
                whatsapp: psid, // PSID stored in whatsapp field for compatibility
                platform: 'messenger',
                nombre: profile?.fullName || 'Usuario Messenger',
                nombreReal: profile?.fullName || null,
                profilePic: profile?.profilePic || null,
                origen: referral?.ad_id ? 'facebook_messenger_ad' : 'facebook_messenger',
                esNuevo: 'SI',
                primerContacto: new Date().toISOString(),
                ...(referral && {
                    adId: referral.ad_id || null,
                    adSource: referral.source || null,
                    adType: referral.type || null,
                    adRef: referral.ref || null,
                })
            });
            candidateId = candidate.id;
            isNewCandidate = true;

            // Index PSID for future lookups
            await indexPSID(psid, candidateId);

            // Also index in the phone index (for compatibility)
            if (redis) {
                await redis.hset('candidates:phone_index', psid, candidateId).catch(() => {});
            }
        }

        // ═══════════════════════════════════════════════════════════
        // 🎯 MESSAGE PERSISTENCE — Message is ALWAYS saved here
        // ═══════════════════════════════════════════════════════════
        const msgToSave = {
            id: msgId,
            from: 'user',
            content: body,
            type: messageType,
            timestamp: new Date().toISOString(),
            platform: 'messenger',
            ...(mediaUrl && { mediaUrl })
        };

        const freshCandidate = await getCandidateById(candidateId) || candidate;
        const updatedCandidate = {
            ...freshCandidate,
            ultimoMensaje: new Date().toISOString(),
            lastUserMessageAt: new Date().toISOString(),
            unreadMsgCount: (Number(freshCandidate?.unreadMsgCount) || 0) + 1,
            mensajesTotales: (Number(freshCandidate?.mensajesTotales) || 0) + 1,
            platform: 'messenger'
        };

        // Update referral data for existing candidates
        if (referral?.ad_id) {
            updatedCandidate.origen = 'facebook_messenger_ad';
            updatedCandidate.adId = referral.ad_id;
            if (referral.source) updatedCandidate.adSource = referral.source;
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
            eventData: { platform: 'messenger', psid, mid: msgId },
            statsType: 'incoming'
        });
        await markMessageAsDone(msgId);
        if (redis) await redis.del('stats:bot:last_calc');

        await logTelemetry('messenger_ingress', {
            msgId, from: psid, type: messageType, isNew: isNewCandidate,
            text: body?.substring(0, 50)
        });

        // ═══════════════════════════════════════════════════════════
        // 🎯 AI PROCESSING (Turbo Engine — same as WhatsApp)
        // ═══════════════════════════════════════════════════════════
        try {
            let isBotActive = await redis?.get('bot_ia_active') !== 'false';
            if (!isBotActive || candidate?.blocked === true) return;

            // Mark as read
            markMessengerMessageAsRead(psid).catch(() => {});

            // Add to waitlist and trigger turbo engine
            await addToWaitlist(candidateId, { text: body, msgId });

            const { runTurboEngine } = await import('../workers/process-message.js');
            await runTurboEngine(candidateId, psid);

        } catch (aiErr) {
            console.error('[Messenger Webhook] ❌ AI Error:', aiErr.message);
        }

    } catch (err) {
        console.error(`[Messenger Webhook] ❌ Error processing ${msgId}:`, err.message);
        await unlockMessage(msgId).catch(() => {});
    }
}
