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
        const { getInstance } = await import('../gateway/session-engine.js');
        const instance = await getInstance(instanceId);
        if (!instance) throw new Error(`Gateway instance ${instanceId} not found`);

        // Call the Railway gateway server's /send endpoint (uses the active socket)
        // gatewayUrl is set on the instance, or falls back to env var
        const gwBaseUrl = instance.gatewayUrl
            || process.env.GATEWAY_SERVER_URL
            || 'https://candidaticia-production.up.railway.app';

        const { default: axios } = await import('axios');
        const result = await axios.post(`${gwBaseUrl}/send/${instanceId}`, {
            to: phone,
            body: message,
            type,
            ...extraParams
        }, { timeout: 30000 });

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

