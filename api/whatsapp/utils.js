import axios from 'axios';

/**
 * ═══════════════════════════════════════════════════════════════════
 * 📡 META CLOUD API — WhatsApp Utils
 * ═══════════════════════════════════════════════════════════════════
 * Direct integration with Meta's Graph API v21.0
 * No Gateway, no proxy, no Baileys — official API only.
 *
 * Env vars required:
 *   META_PHONE_NUMBER_ID  — Your phone number's ID from Meta Dashboard
 *   META_ACCESS_TOKEN     — System User / temporary token
 *   META_WABA_ID          — WhatsApp Business Account ID
 * ═══════════════════════════════════════════════════════════════════
 */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * 🔑 Returns Meta Cloud API config from environment variables.
 * Single-instance — no Redis lookup, no multi-instance routing.
 */
export const getMetaConfig = () => {
    return {
        phoneNumberId: process.env.META_PHONE_NUMBER_ID,
        accessToken: process.env.META_ACCESS_TOKEN,
        wabaId: process.env.META_WABA_ID
    };
};

// Legacy alias — keeps existing imports working without mass-renaming
export const getUltraMsgConfig = async (_requestedInstanceId = null) => {
    const config = getMetaConfig();
    return {
        instanceId: config.phoneNumberId,
        token: config.accessToken,
        ...config
    };
};

/**
 * 📤 Send a WhatsApp message via Meta Cloud API
 *
 * Supports: text, image, video, document, sticker, audio, reaction, location
 */
export const sendMetaMessage = async (to, body, type = 'chat', extraParams = {}) => {
    const config = getMetaConfig();
    if (!config.phoneNumberId || !config.accessToken) {
        console.error('❌ Missing META_PHONE_NUMBER_ID or META_ACCESS_TOKEN');
        return { success: false, error: 'Meta API configuration missing' };
    }

    // Normalize phone: ensure only digits, add country code if needed
    let phone = String(to).replace(/[^\d]/g, '');
    // Remove @c.us or @s.whatsapp.net suffixes if present (legacy compat)
    phone = phone.split('@')[0];

    const url = `${GRAPH_BASE_URL}/${config.phoneNumberId}/messages`;
    const headers = {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
    };

    let payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone
    };

    try {
        // Build payload based on message type
        switch (type) {
            case 'image': {
                let imgUrl = String(body).trim();
                if (!extraParams.mediaId && (!imgUrl || imgUrl === 'null' || imgUrl === 'N/A')) {
                    return { success: true, data: { status: 'filtered_empty_media' } };
                }
                payload.type = 'image';
                payload.image = extraParams.mediaId ? { id: extraParams.mediaId } : { link: imgUrl };
                if (extraParams.caption) payload.image.caption = extraParams.caption;
                break;
            }

            case 'video': {
                payload.type = 'video';
                payload.video = extraParams.mediaId ? { id: extraParams.mediaId } : { link: body };
                if (extraParams.caption) payload.video.caption = extraParams.caption;
                break;
            }

            case 'document': {
                let docUrl = String(body).trim();
                if (!extraParams.mediaId && (!docUrl || docUrl === 'null' || docUrl === 'N/A')) {
                    return { success: true, data: { status: 'filtered_empty_media' } };
                }
                payload.type = 'document';
                payload.document = extraParams.mediaId
                    ? { id: extraParams.mediaId, filename: extraParams.filename || 'documento.pdf' }
                    : { link: docUrl, filename: extraParams.filename || 'documento.pdf' };
                if (extraParams.caption) payload.document.caption = extraParams.caption;
                break;
            }

            case 'sticker': {
                if (extraParams.mediaId) {
                    payload.type = 'sticker';
                    payload.sticker = { id: extraParams.mediaId };
                } else {
                    const finalUrl = body.startsWith('http') ? body : `${process.env.NEXT_PUBLIC_API_URL || 'https://candidatic.com'}${body}`;
                    payload.type = 'sticker';
                    payload.sticker = { link: finalUrl };
                }
                break;
            }

            case 'audio': {
                payload.type = 'audio';
                payload.audio = { link: body };
                break;
            }

            case 'location': {
                payload.type = 'location';
                payload.location = {
                    latitude: extraParams.lat,
                    longitude: extraParams.lng,
                    name: extraParams.name || '',
                    address: extraParams.address || body
                };
                break;
            }

            case 'reaction': {
                payload.type = 'reaction';
                payload.reaction = {
                    message_id: extraParams.messageId,
                    emoji: body
                };
                break;
            }

            case 'template': {
                payload.type = 'template';
                payload.template = {
                    name: extraParams.templateName || body,
                    language: { code: extraParams.languageCode || 'es_MX' }
                };
                if (extraParams.components) {
                    payload.template.components = extraParams.components;
                }
                // Track template send for cost analytics
                try {
                    const { getRedisClient } = await import('../utils/storage.js');
                    const redis = getRedisClient();
                    if (redis) {
                        const now = new Date();
                        const monthKey = `candidatic:templates_sent:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                        await redis.incr(monthKey);
                    }
                } catch (e) {}
                break;
            }

            case 'interactive': {
                payload.type = 'interactive';
                payload.interactive = {
                    type: 'button',
                    body: { text: body },
                    action: {
                        buttons: (extraParams.buttons || []).slice(0, 3).map((btnText, i) => ({
                            type: 'reply',
                            reply: {
                                id: `btn_${Date.now()}_${i}`,
                                title: btnText.substring(0, 20)
                            }
                        }))
                    }
                };
                break;
            }

            case 'contacts': {
                payload.type = 'contacts';
                // Meta requires the phone number without the '+' if present, or just standard string
                let contactPhone = String(extraParams.contactPhone || body).replace(/[^\d+]/g, '');
                payload.contacts = [{
                    name: {
                        first_name: extraParams.contactName || 'Contacto',
                        formatted_name: extraParams.contactName || 'Contacto'
                    },
                    phones: [{
                        phone: contactPhone,
                        type: "WORK"
                    }]
                }];
                break;
            }

            // Default: text message
            default: {
                // Filter technical/empty messages
                const filterRegex = /^\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]$/i;
                const bodyStr = String(body).trim();
                const isTechnical = !bodyStr || filterRegex.test(bodyStr) || bodyStr === "\n\n";

                if (isTechnical) {
                    return { success: true, data: { status: 'filtered_internal_tag_or_empty' } };
                }

                payload.type = 'text';
                payload.text = { body: bodyStr };

                // Reply context (quoting a message)
                if (extraParams.referenceId) {
                    payload.context = { message_id: extraParams.referenceId };
                }
            }
        }

        const startTime = Date.now();
        const response = await axios.post(url, payload, {
            headers,
            timeout: 30000,
            validateStatus: (status) => true
        });
        const duration = Date.now() - startTime;

        // Debug logging
        try {
            const { getRedisClient } = await import('../utils/storage.js');
            const redis = getRedisClient();
            if (redis) {
                redis.set(`debug:meta_send:${phone}`, JSON.stringify({
                    timestamp: new Date().toISOString(),
                    duration,
                    status: response.status,
                    type,
                    result: response.data
                }), 'EX', 3600).catch(() => { });
            }
        } catch (e) { }

        if (response.status === 200 || response.status === 201) {
            // Track outgoing message stats
            try {
                const { incrementMessageStats } = await import('../utils/storage.js');
                incrementMessageStats('outgoing').catch(() => { });
            } catch (e) { }

            return {
                success: true,
                data: response.data,
                messageId: response.data?.messages?.[0]?.id,
                via: 'meta_cloud_api'
            };
        }

        // Handle Meta API errors
        const errorMsg = response.data?.error?.message || `HTTP ${response.status}`;
        console.error(`❌ Meta API [${type}] Error:`, errorMsg, response.data);

        // Check for invalid number
        if (response.data?.error?.code === 131026) {
            try {
                const { getCandidateIdByPhone, updateCandidate } = await import('../utils/storage.js');
                const candidateId = await getCandidateIdByPhone(phone);
                if (candidateId) {
                    await updateCandidate(candidateId, {
                        status: 'Incontactable',
                        incontactable: true,
                        blocked: true
                    });
                    console.log(`[META API] Número inválido: ${phone} → Marcado como Incontactable.`);
                }
            } catch (e) { }
        }

        return { success: false, error: errorMsg, data: response.data };

    } catch (error) {
        console.error('❌ Meta API fatal error:', error.message);
        return { success: false, error: error.message };
    }
};

export const sendUltraMsgMessage = async (_instanceId, _token, to, body, type = 'chat', extraParams = {}) => {
    // All messages always go via Meta Cloud API
    return sendMetaMessage(to, body, type, extraParams);
};

/**
 * ✅ Mark a message as read
 */
export const markMessageAsRead = async (messageId) => {
    const config = getMetaConfig();
    if (!config.phoneNumberId || !config.accessToken || !messageId) return;

    try {
        const url = `${GRAPH_BASE_URL}/${config.phoneNumberId}/messages`;
        await axios.post(url, {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId
        }, {
            headers: {
                'Authorization': `Bearer ${config.accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        return { success: true };
    } catch (e) {
        return { success: false };
    }
};

// Legacy alias
export const sendUltraMsgRead = async (_instanceId, _token, _to, messageId) => {
    return markMessageAsRead(messageId);
};

/**
 * 😀 Send a reaction to a message
 */
export const sendMetaReaction = async (toPhone, messageId, emoji) => {
    if (!messageId || !toPhone) return null;
    return sendMetaMessage(toPhone, emoji, 'reaction', { messageId });
};

// Legacy alias
export const sendUltraMsgReaction = async (_instanceId, _token, messageId, emoji, toPhone = 'N/A') => {
    return sendMetaMessage(toPhone, emoji, 'reaction', { messageId });
};

/**
 * 📥 Download media from Meta's CDN
 * Meta provides a media_id. First GET the URL, then download the binary.
 */
export const downloadMetaMedia = async (mediaId) => {
    const config = getMetaConfig();
    if (!mediaId || !config.accessToken) return null;

    try {
        // Step 1: Get the media URL
        const metaUrl = `${GRAPH_BASE_URL}/${mediaId}`;
        const metaRes = await axios.get(metaUrl, {
            headers: { 'Authorization': `Bearer ${config.accessToken}` },
            timeout: 10000
        });

        const downloadUrl = metaRes.data?.url;
        if (!downloadUrl) return null;

        // Step 2: Download the actual file
        const fileRes = await axios.get(downloadUrl, {
            headers: { 'Authorization': `Bearer ${config.accessToken}` },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        return {
            buffer: Buffer.from(fileRes.data),
            mimeType: metaRes.data?.mime_type,
            fileSize: metaRes.data?.file_size,
            url: downloadUrl
        };
    } catch (e) {
        console.error('❌ Meta media download error:', e.message);
        return null;
    }
};

/**
 * 📡 Returns the single active config (replaces multi-instance concept)
 */
export const getAllActiveInstances = async () => {
    const config = getMetaConfig();
    if (!config.phoneNumberId) return [];
    return [{ instanceId: config.phoneNumberId, token: config.accessToken }];
};

export const getInstanceForCandidate = async (_candidateData) => {
    return getUltraMsgConfig();
};

// ─── STUBS for removed features ──────────────────────────────────
// These no-op to prevent import errors in code that hasn't been cleaned up yet

export const sendUltraMsgPresence = async () => ({ success: true });
export const getUltraMsgContact = async () => null;
export const resolveUltraMsgJid = async (_i, _t, phone) => phone;
export const blockUltraMsgContact = async () => ({ success: false, error: 'Not supported by Meta API' });
export const unblockUltraMsgContact = async () => ({ success: false, error: 'Not supported by Meta API' });

/**
 * 📤 Upload media to Meta's servers and get a media_id
 * This is the reliable way to send media — Meta doesn't need to download from our servers.
 *
 * @param {Buffer} buffer  - File binary data
 * @param {string} mimeType - e.g. 'application/pdf', 'image/jpeg'
 * @param {string} [filename] - Optional filename for display
 * @returns {{ mediaId: string } | null}
 */
export const uploadMediaToMeta = async (buffer, mimeType, filename = 'file') => {
    const config = getMetaConfig();
    if (!config.phoneNumberId || !config.accessToken) {
        console.error('❌ [uploadMediaToMeta] Missing Meta config');
        return null;
    }

    try {
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        
        let basicType = 'document';
        if (mimeType.startsWith('image/')) basicType = 'image';
        else if (mimeType.startsWith('video/')) basicType = 'video';
        else if (mimeType.startsWith('audio/')) basicType = 'audio';

        form.append('messaging_product', 'whatsapp');
        form.append('file', buffer, { filename, contentType: mimeType });
        form.append('type', basicType);

        const url = `${GRAPH_BASE_URL}/${config.phoneNumberId}/media`;
        const response = await axios.post(url, form, {
            headers: {
                'Authorization': `Bearer ${config.accessToken}`,
                ...form.getHeaders()
            },
            timeout: 30000,
            maxContentLength: 20 * 1024 * 1024,
            maxBodyLength: 20 * 1024 * 1024
        });

        if (response.data?.id) {
            console.log(`✅ [uploadMediaToMeta] Uploaded ${filename} (${mimeType}) → media_id=${response.data.id}`);
            return { mediaId: response.data.id };
        }

        console.error('❌ [uploadMediaToMeta] No media_id in response:', response.data);
        return null;
    } catch (error) {
        console.error('❌ [uploadMediaToMeta] Error:', error.response?.data || error.message);
        return null;
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════
 * 🧱 Build Meta Template Components (DRY Helper)
 * ═══════════════════════════════════════════════════════════════════
 * Constructs the `components` array for Meta Cloud API template sends.
 * Used by both chat.js (single send) and bulks.js (mass send).
 *
 * @param {Array} templateComponents - The components array from templateData
 * @param {string} candidateNameFallback - Fallback text for variables (usually candidate name)
 * @param {Object} [options] - Optional config
 * @param {Object} [options.templateParams] - Custom params map (key: var index/name → value)
 * @param {string} [options.mediaUrl] - Override URL for media headers
 * @returns {Array} componentsToSend ready for Meta API
 */
export const buildMetaTemplateComponents = (templateComponents, candidateNameFallback, options = {}) => {
    const { templateParams, mediaUrl } = options;
    const componentsToSend = [];

    (templateComponents || []).forEach(comp => {
        const cType = (comp.type || '').toLowerCase();

        if (cType === 'body' || cType === 'header') {
            if (cType === 'body' || (comp.format || '').toLowerCase() === 'text') {
                const textInfo = comp.text || '';
                const varMatches = textInfo.match(/\{\{[^}]+\}\}/g) || [];
                let expectedCount = [...new Set(varMatches)].length;
                const uniqueVars = [...new Set(varMatches)];

                // Source of truth from Meta's parsed examples
                if (cType === 'body' && comp.example?.body_text?.[0]) {
                    expectedCount = comp.example.body_text[0].length;
                } else if (cType === 'header' && comp.example?.header_text) {
                    expectedCount = comp.example.header_text.length;
                }

                if (expectedCount > 0) {
                    const params = Array(expectedCount).fill(0).map((_, pIdx) => {
                        // Try custom param by numeric key
                        const numKey = String(pIdx + 1);
                        let customVal = templateParams?.[numKey];

                        // Fallback to searching by named variable at this position
                        if (!customVal && uniqueVars[pIdx]) {
                            const stringKey = uniqueVars[pIdx].replace(/[{}]/g, '');
                            customVal = templateParams?.[stringKey];
                        }

                        return { type: "text", text: customVal || candidateNameFallback };
                    });
                    componentsToSend.push({ type: cType, parameters: params });
                }
            } else if (cType === 'header') {
                const format = (comp.format || '').toLowerCase();
                if (['image', 'video', 'document'].includes(format)) {
                    const placeholders = {
                        image: 'https://raw.githubusercontent.com/davidcelis/logo/master/logo.png',
                        video: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
                        document: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
                    };
                    const mUrl = mediaUrl || placeholders[format] || placeholders.image;
                    componentsToSend.push({
                        type: 'header',
                        parameters: [{ type: format, [format]: { link: mUrl } }]
                    });
                }
            }
        } else if (cType === 'buttons') {
            (comp.buttons || []).forEach((btn, index) => {
                if ((btn.type || '').toLowerCase() === 'url' && (btn.url || '').includes('{{')) {
                    const btnVarMatches = (btn.url || '').match(/\{\{\d+\}\}/g) || [];
                    const uniqueBtnVars = [...new Set(btnVarMatches)];
                    if (uniqueBtnVars.length > 0) {
                        componentsToSend.push({
                            type: 'button',
                            sub_type: 'url',
                            index: String(index),
                            parameters: uniqueBtnVars.map(() => ({ type: "text", text: "info" }))
                        });
                    }
                }
            });
        }
    });

    return componentsToSend;
};
