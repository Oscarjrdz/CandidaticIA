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
        let endpoint = type === 'voice' ? 'audio' : type;
        if (!['chat', 'image', 'video', 'audio', 'document'].includes(endpoint)) endpoint = 'chat';

        const payload = { token, to };

        // Clean Base64: Strip header for UltraMSG
        let cleanBody = body;
        const isDataUrl = typeof body === 'string' && body.startsWith('data:');
        if (isDataUrl && body.includes(';base64,')) {
            cleanBody = body.split(';base64,')[1];
        }

        const isHttp = typeof body === 'string' && body.startsWith('http');

        switch (endpoint) {
            case 'image':
                payload.image = isHttp ? (body.includes('?') ? `${body}&ext=.jpg` : `${body}?ext=.jpg`) : cleanBody;
                if (extraParams.caption) payload.caption = extraParams.caption;
                break;
            case 'video':
                payload.video = isHttp ? (body.includes('?') ? `${body}&ext=.mp4` : `${body}?ext=.mp4`) : cleanBody;
                if (extraParams.caption) payload.caption = extraParams.caption;
                break;
            case 'audio':
                payload.audio = isHttp ? (body.includes('?') ? `${body}&ext=.mp3` : `${body}?ext=.mp3`) : cleanBody;
                if (type === 'voice') payload.ptt = 'true';
                break;
            case 'document':
                payload.document = body;
                if (extraParams.filename) payload.filename = extraParams.filename;
                break;
            default:
                payload.body = body;
        }

        const url = `https://api.ultramsg.com/${instanceId}/messages/${endpoint}`;

        console.log(`🚀 [UltraMSG] EXECUTE: ${type} -> ${to} (Format: ${isHttp ? 'URL' : 'BASE64'}, Len: ${body?.length})`);

        const redis = getRedisClient();
        const debugKey = `debug:ultramsg:${to}`;

        let response;
        try {
            response = await axios.post(url, payload, { timeout: 25000 });
            console.log(`✅ [UltraMSG] RESPONSE:`, JSON.stringify(response.data));

            if (redis) {
                await redis.set(debugKey, JSON.stringify({
                    timestamp: new Date().toISOString(),
                    type, endpoint, result: response.data
                }), 'EX', 3600);
            }
            return response.data;
        } catch (postErr) {
            const errData = postErr.response?.data;
            console.error(`❌ UltraMSG [${type}] Connection/API Error:`, errData || postErr.message);
            if (redis) {
                await redis.set(`${debugKey}:error`, JSON.stringify({
                    timestamp: new Date().toISOString(),
                    type, endpoint, error: errData || postErr.message
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
