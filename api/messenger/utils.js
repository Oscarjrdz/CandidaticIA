/**
 * ═══════════════════════════════════════════════════════════════════
 * 💬 MESSENGER PLATFORM — Send API Utils
 * ═══════════════════════════════════════════════════════════════════
 * Sends messages to Facebook Messenger users via the Page Send API.
 * Uses a dynamically-fetched Page Access Token (same pattern as ads-comments).
 *
 * Messenger identifies users by PSID (Page-Scoped ID), not phone number.
 * ═══════════════════════════════════════════════════════════════════
 */
import axios from 'axios';

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ─── Cache the Page Token in-memory (per cold start) ─────────────
let _cachedPageToken = null;
let _cacheTimestamp = 0;
const PAGE_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetches the Page Access Token.
 * Priority: 
 *   1. MESSENGER_PAGE_TOKEN env var (dedicated, most reliable)
 *   2. Dynamic fetch from /me/accounts
 *   3. Fallback to META_ACCESS_TOKEN directly
 */
export const getPageToken = async () => {
    // Priority 1: Dedicated Messenger Page Token
    const dedicatedToken = process.env.MESSENGER_PAGE_TOKEN;
    if (dedicatedToken) return dedicatedToken;

    // Priority 2: Cache check
    const now = Date.now();
    if (_cachedPageToken && (now - _cacheTimestamp) < PAGE_TOKEN_TTL_MS) {
        return _cachedPageToken;
    }

    const systemToken = process.env.META_ACCESS_TOKEN;
    if (!systemToken) {
        console.error('[Messenger Utils] ❌ No token configured');
        return null;
    }

    // Priority 3: Dynamic fetch from /me/accounts
    try {
        const res = await axios.get(`${GRAPH_BASE_URL}/me/accounts`, {
            params: { access_token: systemToken },
            timeout: 10000
        });

        const pageToken = res.data?.data?.[0]?.access_token;
        if (pageToken) {
            _cachedPageToken = pageToken;
            _cacheTimestamp = now;
            return pageToken;
        }

        console.error('[Messenger Utils] ⚠️ No page in /me/accounts, using META_ACCESS_TOKEN as fallback');
    } catch (e) {
        console.error('[Messenger Utils] ⚠️ /me/accounts failed:', e.message, '— using fallback');
    }

    // Priority 4: Use META_ACCESS_TOKEN directly (may work if it has page permissions)
    return systemToken;
};

/**
 * 📤 Send a message to a Messenger user via the Page Send API.
 *
 * @param {string} psid  — The Page-Scoped ID of the recipient
 * @param {string} body  — Message text (or media URL for non-text types)
 * @param {string} type  — 'text' | 'image' | 'video' | 'audio' | 'document'
 * @param {Object} extra — Additional params (caption, filename, etc.)
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
export const sendMessengerMessage = async (psid, body, type = 'text', extra = {}) => {
    const pageToken = await getPageToken();
    if (!pageToken) {
        return { success: false, error: 'No Page Token available for Messenger' };
    }

    const url = `${GRAPH_BASE_URL}/me/messages`;

    let messagePayload;

    // Filter empty/technical messages (same logic as WhatsApp)
    const filterRegex = /^\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]$/i;
    const bodyStr = String(body || '').trim();

    switch (type) {
        case 'image': {
            const imgUrl = bodyStr;
            if (!imgUrl || imgUrl === 'null' || imgUrl === 'N/A') {
                return { success: true, data: { status: 'filtered_empty_media' } };
            }
            messagePayload = {
                attachment: {
                    type: 'image',
                    payload: { url: imgUrl, is_reusable: true }
                }
            };
            break;
        }

        case 'video': {
            messagePayload = {
                attachment: {
                    type: 'video',
                    payload: { url: bodyStr, is_reusable: true }
                }
            };
            break;
        }

        case 'audio': {
            messagePayload = {
                attachment: {
                    type: 'audio',
                    payload: { url: bodyStr, is_reusable: true }
                }
            };
            break;
        }

        case 'document': {
            messagePayload = {
                attachment: {
                    type: 'file',
                    payload: { url: bodyStr, is_reusable: true }
                }
            };
            break;
        }

        case 'sticker': {
            // Messenger doesn't support stickers natively — send as image
            messagePayload = {
                attachment: {
                    type: 'image',
                    payload: { url: bodyStr, is_reusable: false }
                }
            };
            break;
        }

        // Default: text message
        default: {
            if (!bodyStr || filterRegex.test(bodyStr) || bodyStr === '\n\n') {
                return { success: true, data: { status: 'filtered_internal_tag_or_empty' } };
            }
            messagePayload = { text: bodyStr };
        }
    }

    try {
        const response = await axios.post(url, {
            recipient: { id: psid },
            message: messagePayload,
            messaging_type: 'RESPONSE'
        }, {
            params: { access_token: pageToken },
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
            validateStatus: () => true
        });

        if (response.status === 200 || response.status === 201) {
            return {
                success: true,
                messageId: response.data?.message_id,
                data: response.data,
                via: 'messenger_send_api'
            };
        }

        const errorMsg = response.data?.error?.message || `HTTP ${response.status}`;
        console.error(`[Messenger Send] ❌ Error [${type}]:`, errorMsg, response.data);
        return { success: false, error: errorMsg, data: response.data };

    } catch (error) {
        console.error('[Messenger Send] ❌ Fatal:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Fetch Messenger user profile (name, profile pic) by PSID
 */
export const getMessengerProfile = async (psid) => {
    const pageToken = await getPageToken();
    if (!pageToken || !psid) return null;

    try {
        const res = await axios.get(`${GRAPH_BASE_URL}/${psid}`, {
            params: {
                fields: 'first_name,last_name,profile_pic',
                access_token: pageToken
            },
            timeout: 10000
        });

        return {
            firstName: res.data?.first_name || '',
            lastName: res.data?.last_name || '',
            profilePic: res.data?.profile_pic || null,
            fullName: `${res.data?.first_name || ''} ${res.data?.last_name || ''}`.trim()
        };
    } catch (e) {
        console.error('[Messenger Profile] ❌ Error:', e.message);
        return null;
    }
};

/**
 * Mark a message as read (Sender Actions)
 */
export const markMessengerMessageAsRead = async (psid) => {
    const pageToken = await getPageToken();
    if (!pageToken || !psid) return;

    try {
        await axios.post(`${GRAPH_BASE_URL}/me/messages`, {
            recipient: { id: psid },
            sender_action: 'mark_seen'
        }, {
            params: { access_token: pageToken },
            timeout: 5000
        });
    } catch (e) {
        // Non-fatal
    }
};

/**
 * Show typing indicator
 */
export const sendMessengerTyping = async (psid, on = true) => {
    const pageToken = await getPageToken();
    if (!pageToken || !psid) return;

    try {
        await axios.post(`${GRAPH_BASE_URL}/me/messages`, {
            recipient: { id: psid },
            sender_action: on ? 'typing_on' : 'typing_off'
        }, {
            params: { access_token: pageToken },
            timeout: 5000
        });
    } catch (e) {
        // Non-fatal
    }
};
