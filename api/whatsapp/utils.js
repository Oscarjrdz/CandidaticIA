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
            const config = await redis.get('ultramsg_config');
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

        console.log(`🚀 [UltraMSG] SEND: ${endpoint} -> ${to} (${isHttp ? 'URL' : 'TEXT'})`);

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
            console.log(`✅ [UltraMSG] RESPONSE (${duration}ms): Status=${response.status} | Data=`, JSON.stringify(response.data));

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

            // COUNT STATS (OUTGOING)
            if (response.status === 200) {
                const { incrementMessageStats } = await import('../utils/storage.js');
                incrementMessageStats('outgoing');
            }

            return response.data;
        } catch (postErr) {
            const errData = postErr.response?.data;
            console.error(`❌ UltraMSG [${type}] Connection/API Error:`, errData || postErr.message);
            if (redis) {
                await redis.set(`${debugKey}:error`, JSON.stringify({
                    timestamp: new Date().toISOString(),
                    type, endpoint: endpoint, error: errData || postErr.message
                }), 'EX', 3600);
            }
            throw postErr;
        }
    } catch (error) {
        throw error;
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

        console.log(`📖 [UltraMsg] Marking chat ${formattedChatId} as read...`);
        const url = `https://api.ultramsg.com/${instanceId}/chats/read`;

        const response = await axios.post(url, {
            token: token,
            chatId: formattedChatId
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 5000 // 5s timeout
        });

        console.log(`✅ [UltraMsg] Mark as read success for ${formattedChatId}:`, response.data);
        return response.data;
    } catch (error) {
        const errorData = error.response?.data;
        console.error(`❌ [UltraMsg] Mark as read FAILED for ${chatId}:`, errorData || error.message);
        return null;
    }
};

export const downloadMedia = async (url) => {
    try {
        console.log(`📥 [UltraMsg] Downloading media from ${url}...`);
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
