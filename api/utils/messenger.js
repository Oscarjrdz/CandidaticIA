import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';
import { getRedisClient } from './storage.js';

// Gateway channel key (set by gateway/webhook.js when a message comes in)
const GW_CHANNEL_KEY = (phone) => `gw_channel:${phone}`;

/**
 * Smart messenger — routes replies through the same channel the message arrived on.
 * - If the candidate messaged via a Gateway instance → reply via Gateway
 * - Otherwise → reply via UltraMsg (existing behavior)
 */
export const sendMessage = async (number, message, type = 'chat', extraParams = {}) => {
    try {
        // Normalize phone
        const phone = String(number).replace(/\D/g, '');

        // ── Check for active Gateway channel ──────────────────────────────────
        try {
            const redis = getRedisClient();
            const gwInstanceId = await redis?.get(GW_CHANNEL_KEY(phone));

            if (gwInstanceId) {
                return await _sendViaGateway(gwInstanceId, phone, message, type, extraParams);
            }
        } catch (e) {
            // Redis lookup failed — fall through to UltraMsg
            console.warn('[MESSENGER] Gateway channel lookup failed, using UltraMsg:', e.message);
        }

        // ── Default: UltraMsg ─────────────────────────────────────────────────
        const config = await getUltraMsgConfig();

        if (!config || !config.instanceId || !config.token) {
            console.error('❌ Missing UltraMsg Configuration (Checked Env & Redis)');
            return { success: false, error: 'Configuration missing: ULTRAMSG_INSTANCE_ID or TOKEN' };
        }

        const result = await sendUltraMsgMessage(config.instanceId, config.token, number, message, type, extraParams);

        if (!result.success) {
            return { success: false, error: result.error || 'UltraMsg Send Error' };
        }

        return { success: true, data: result.data };

    } catch (error) {
        console.error('❌ Error sending message:', error.message);
        return { success: false, error: error.message };
    }
};

// ─── Internal: Send via our own Gateway ────────────────────────────────────────
async function _sendViaGateway(instanceId, phone, message, type = 'chat', extraParams = {}) {
    try {
        const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : (process.env.NEXTAUTH_URL || 'https://candidatic-ia.vercel.app');

        const { getInstance } = await import('../gateway/session-engine.js');
        const instance = await getInstance(instanceId);
        if (!instance?.token) throw new Error(`Gateway instance ${instanceId} not found or no token`);

        const body = {};
        body.token = instance.token;
        body.to = phone;

        // Map message types
        switch (type) {
            case 'image':
                body.body = message;
                if (extraParams.caption) body.caption = extraParams.caption;
                break;
            case 'document':
                body.body = message;
                body.filename = extraParams.filename || 'documento.pdf';
                break;
            case 'sticker':
                body.body = message;
                break;
            case 'location':
                body.lat = extraParams.lat;
                body.lng = extraParams.lng;
                body.address = extraParams.address;
                break;
            default: // chat
                body.body = message;
        }

        const msgType = ['image', 'document', 'sticker', 'location'].includes(type) ? type : 'chat';
        const url = `${baseUrl}/api/gateway/send/${instanceId}/messages/${msgType}`;

        const { default: axios } = await import('axios');
        const result = await axios.post(url, body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        if (result.data?.success) {
            return { success: true, data: result.data, via: 'gateway', instanceId };
        }

        throw new Error(result.data?.error || 'Gateway send failed');

    } catch (err) {
        console.error(`[MESSENGER] Gateway send via ${instanceId} failed:`, err.message);
        // Fallback to UltraMsg on error
        const config = await getUltraMsgConfig();
        if (config) {
            return await sendUltraMsgMessage(config.instanceId, config.token, phone, message, type, extraParams);
        }
        return { success: false, error: err.message };
    }
}
