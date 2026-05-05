import { sendMetaMessage } from '../whatsapp/utils.js';
import { sendMessengerMessage } from '../messenger/utils.js';
import { getRedisClient } from './storage.js';

/**
 * 🚀 SMART MESSENGER v4 — Multi-Platform Router
 *
 * Automatically detects whether the recipient is a WhatsApp user or
 * a Messenger user, and routes through the correct API.
 *
 * Detection: checks the `messenger:psid_index` Redis hash.
 * If the recipient's ID is found there, it's a Messenger PSID.
 * Otherwise, it's a WhatsApp phone number (default).
 *
 * This keeps ALL existing call sites (agent.js, recruiter-agent.js, etc.)
 * working without any modifications.
 */

// In-memory cache for PSID lookups (avoids Redis round-trip on every message)
const _psidCache = new Map();
const PSID_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const isMessengerPSID = async (identifier) => {
    if (!identifier) return false;

    // Check in-memory cache first
    const cached = _psidCache.get(identifier);
    if (cached && (Date.now() - cached.ts) < PSID_CACHE_TTL) {
        return cached.isMessenger;
    }

    try {
        const client = getRedisClient();
        if (!client) return false;

        const candidateId = await client.hget('messenger:psid_index', identifier);
        const isMessenger = !!candidateId;

        _psidCache.set(identifier, { isMessenger, ts: Date.now() });
        return isMessenger;
    } catch (e) {
        return false;
    }
};

export const sendMessage = async (number, message, type = 'chat', extraParams = {}) => {
    try {
        const identifier = String(number).replace(/[^\d@.]/g, '');

        // Check if this is a Messenger PSID
        const useMessenger = await isMessengerPSID(identifier);

        if (useMessenger) {
            // Route through Messenger Send API
            const messengerType = type === 'chat' ? 'text' : type;
            const result = await sendMessengerMessage(identifier, message, messengerType, extraParams);

            if (!result.success) {
                return { success: false, error: result.error || 'Messenger Send Error' };
            }

            return {
                success: true,
                data: result.data,
                messageId: result.messageId,
                via: 'messenger_send_api'
            };
        }

        // Default: Route through WhatsApp Cloud API
        const result = await sendMetaMessage(identifier, message, type, extraParams);

        if (!result.success) {
            return { success: false, error: result.error || 'Meta API Send Error' };
        }

        return {
            success: true,
            data: result.data,
            messageId: result.messageId,
            via: 'meta_cloud_api'
        };

    } catch (error) {
        console.error('❌ Error sending message:', error.message);
        return { success: false, error: error.message };
    }
};
