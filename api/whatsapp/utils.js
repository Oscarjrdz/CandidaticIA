import axios from 'axios';
import { getRedisClient } from '../utils/storage.js';

export const getUltraMsgConfig = async () => {
    // 1. Try environment variables first (most secure)
    if (process.env.ULTRAMSG_INSTANCE_ID && process.env.ULTRAMSG_TOKEN) {
        return {
            instanceId: process.env.ULTRAMSG_INSTANCE_ID,
            token: process.env.ULTRAMSG_TOKEN
        };
    }

    // 2. Try Redis (dynamic config)
    // Note: In a real implementation where we receive a webhook, 
    // we might not know ISNTANCE_ID unless passed in URL.
    // For single-tenant, storing in Redis is fine.
    try {
        const redis = getRedisClient();
        if (redis) {
            // First try 'ultramsg_credentials' (new standard)
            let config = await redis.get('ultramsg_credentials');

            // Fallback to 'ultramsg_config' (old key)
            if (!config) {
                config = await redis.get('ultramsg_config');
            }

            if (config) {
                return JSON.parse(config);
            }
        }
    } catch (e) {
        console.warn('Failed to load UltraMsg config from Redis', e);
    }

    return null;
};

export const sendUltraMsgMessage = async (instanceId, token, to, body, type = 'chat', extraParams = {}) => {
    try {
        let endpoint = type;
        if (!['chat', 'image', 'video', 'audio', 'voice', 'document'].includes(endpoint)) endpoint = 'chat';

        const payload = { token, to };

        // Handle Base64 vs URL
        const isHttp = typeof body === 'string' && body.startsWith('http');

        switch (endpoint) {
            case 'image':
                payload.image = isHttp ? (body.includes('?') ? `${body}&ext=.jpg` : `${body}?ext=.jpg`) : body;
                if (extraParams.caption) payload.caption = extraParams.caption;
                break;
            case 'video':
                payload.video = isHttp ? (body.includes('?') ? `${body}&ext=.mp4` : `${body}?ext=.mp4`) : body;
                if (extraParams.caption) payload.caption = extraParams.caption;
                break;
            case 'document':
                payload.document = body;
                payload.filename = extraParams.filename || 'document.pdf';
                break;
            default:
                payload.body = body;
        }

        const url = `https://api.ultramsg.com/${instanceId}/messages/${endpoint}`;


        const redis = getRedisClient();
        const debugKey = `debug:ultramsg:${to}`;

        let response;
        const startTime = Date.now();
        try {
            response = await axios.post(url, payload, {
                timeout: 30000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                validateStatus: (status) => true // Capture all status codes
            });
            const duration = Date.now() - startTime;

            if (redis) {
                const sanitizedPayload = { ...payload };
                if (sanitizedPayload.token) sanitizedPayload.token = '***_masked_***';

                await redis.set(debugKey, JSON.stringify({
                    timestamp: new Date().toISOString(),
                    duration,
                    status: response.status,
                    type,
                    endpoint: endpoint,
                    fullPayload: sanitizedPayload,
                    result: response.data
                }), 'EX', 3600);
            }

            if (response.status !== 200) {
                console.error(`❌ UltraMSG [${type}] API Error (${response.status}):`, response.data);
                return {
                    success: false,
                    status: response.status,
                    error: (response.data && typeof response.data === 'object') ? JSON.stringify(response.data) : (response.data || 'Unknown API Error')
                };
            }

            // COUNT STATS (OUTGOING)
            if (response.status === 200) {
                try {
                    const { incrementMessageStats } = await import('../utils/storage.js');
                    await incrementMessageStats('outgoing');
                } catch (e) {
                    console.warn('Failed to increment stats', e.message);
                }
            }

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error(`❌ UltraMSG [${type}] Connection Error:`, error.message);
            return {
                success: false,
                error: error.message || 'Connection failed'
            };
        }
    } catch (outerError) {
        console.error('❌ sendUltraMsgMessage fatal error:', outerError.message);
        return { success: false, error: outerError.message };
    }
};

export const getUltraMsgContact = async (instanceId, token, chatId) => {
    try {
        const url = `https://api.ultramsg.com/${instanceId}/contacts/image`;
        const response = await axios.get(url, {
            params: {
                token: token,
                chatId: chatId
            }
        });
        return response.data;
    } catch (error) {
        console.error('UltraMsg Get Image Error:', error.response?.data || error.message);
        return null;
    }
};
export const markUltraMsgAsRead = async (instanceId, token, chatId) => {
    try {
        // Ensure chatId has the correct format for WhatsApp (number@c.us)
        let formattedChatId = String(chatId).trim();
        if (!formattedChatId.includes('@')) {
            // Clean non-digits and add suffix
            const cleanPhone = formattedChatId.replace(/\D/g, '');
            formattedChatId = `${cleanPhone}@c.us`;
        }

        const url = `https://api.ultramsg.com/${instanceId}/chats/read`;

        const params = new URLSearchParams();
        params.append('token', token);
        params.append('chatId', formattedChatId);

        const response = await axios.post(url, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 5000
        });

        if (response.status !== 200) {
            console.error(`❌ [UltraMsg] Mark as read API error (${response.status}):`, response.data);
        }

        return response.data;
    } catch (error) {
        const errorData = error.response?.data;
        console.error(`❌ [UltraMsg] Mark as read FAILED for ${chatId}:`, errorData || error.message);
        return null;
    }
};

/**
 * Send presence (typing/recording) status
 * @param {string} instanceId 
 * @param {string} token 
 * @param {string} chatId 
 * @param {string} presence - 'composing' (typing) or 'recording'
 */
export const sendUltraMsgPresence = async (instanceId, token, chatId, presence = 'composing') => {
    try {
        let formattedChatId = String(chatId).trim();
        if (!formattedChatId.includes('@')) {
            const cleanPhone = formattedChatId.replace(/\D/g, '');
            formattedChatId = `${cleanPhone}@c.us`;
        }

        // --- TRY MULTIPLE ENDPOINTS AND FORMATS (FORM vs JSON) ---
        const endpoints = ['chats/presence', 'chats/typing'];

        for (const endpoint of endpoints) {
            const url = `https://api.ultramsg.com/${instanceId}/${endpoint}`;

            // 1. Standard Form-Data (Legacy)
            const params = new URLSearchParams();
            params.append('token', token);
            params.append('chatId', formattedChatId);
            params.append('presence', presence);
            params.append('type', presence);
            axios.post(url, params, {
                timeout: 3000,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }).catch(() => { });

            // 2. Modern JSON
            const payload = { token, chatId: formattedChatId, presence, type: presence };
            axios.post(url, payload, { timeout: 3000 }).catch(() => { });
        }

        // Log one success (or attempt) to Redis
        const redis = getRedisClient();
        if (redis) {
            await redis.set(`debug:presence:${formattedChatId}`, JSON.stringify({
                timestamp: new Date().toISOString(),
                presence,
                attempted_endpoints: endpoints
            }), 'EX', 600);
        }

        return { success: true };
    } catch (error) {
        console.error(`❌ [UltraMsg] Presence FAILED for ${chatId}:`, error.message);
        return null;
    }
};

export const downloadMedia = async (url) => {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        return {
            data: buffer.toString('base64'),
            mimeType: response.headers['content-type']
        };
    } catch (error) {
        console.error('❌ Failed to download media:', error.message);
        return null;
    }
};
