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
        let endpoint = 'chat';
        const payload = { token, to };

        // Sanitize body: If it's a Data URL (base64 with header), strip the header
        let cleanBody = body;
        const isBase64 = body && body.startsWith('data:') && body.includes(';base64,');
        if (isBase64) {
            cleanBody = body.split(';base64,')[1];
        }

        switch (type) {
            case 'image':
                endpoint = 'image';
                payload.image = body.startsWith('http') ? (body.includes('?') ? `${body}&ext=.jpg` : `${body}?ext=.jpg`) : cleanBody;
                if (extraParams.caption) payload.caption = extraParams.caption;
                break;
            case 'video':
                endpoint = 'video';
                payload.video = body.startsWith('http') ? (body.includes('?') ? `${body}&ext=.mp4` : `${body}?ext=.mp4`) : cleanBody;
                if (extraParams.caption) payload.caption = extraParams.caption;
                break;
            case 'audio':
                endpoint = 'audio';
                payload.audio = body.startsWith('http') ? (body.includes('?') ? `${body}&ext=.mp3` : `${body}?ext=.mp3`) : cleanBody;
                break;
            case 'voice':
                endpoint = 'voice';
                payload.audio = body.startsWith('http') ? (body.includes('?') ? `${body}&ext=.ogg` : `${body}?ext=.ogg`) : cleanBody;
                break;
            case 'document':
                endpoint = 'document';
                payload.document = body;
                if (extraParams.filename) payload.filename = extraParams.filename;
                break;
            default:
                endpoint = 'chat';
                payload.body = body;
        }

        const url = `https://api.ultramsg.com/${instanceId}/messages/${endpoint}`;

        console.log(`🚀 [UltraMSG] EXECUTE: ${type} -> ${to} (Base64: ${isBase64}, BodyLen: ${body?.length})`);

        const response = await axios.post(url, payload);

        console.log(`✅ [UltraMSG] RESPONSE:`, JSON.stringify(response.data));

        return response.data;
    } catch (error) {
        const errorData = error.response?.data;
        console.error(`❌ UltraMSG [${type}] Critical Error:`, {
            status: error.response?.status,
            message: error.message,
            details: errorData
        });
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
