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
        const isDataUrl = typeof body === 'string' && body.startsWith('data:');

        let deliveryBody = body;
        let filenameHint = extraParams.filename;

        if (isDataUrl) {
            const parts = body.split(',');
            deliveryBody = parts[1] || body;

            if (!filenameHint) {
                const mimeMatch = parts[0].match(/data:(.*?);/);
                const mime = mimeMatch ? mimeMatch[1] : '';
                if (mime.includes('audio')) filenameHint = (type === 'voice' || endpoint === 'voice') ? 'voice.ogg' : 'audio.mp3';
                else if (mime.includes('image')) filenameHint = 'image.jpg';
                else if (mime.includes('video')) filenameHint = 'video.mp4';
                else filenameHint = 'file.pdf';
            }
        }

        // ENDPOINT MAPPING:
        // UltraMsg uses /messages/voice for PTT voice notes.
        // It uses 'audio' as the parameter name for the file.
        let finalEndpoint = endpoint;
        if (endpoint === 'voice') finalEndpoint = 'voice';

        switch (endpoint) {
            case 'image':
                payload.image = isHttp ? (body.includes('?') ? `${body}&ext=.jpg` : `${body}?ext=.jpg`) : deliveryBody;
                if (extraParams.caption) payload.caption = extraParams.caption;
                if (!isHttp) payload.filename = filenameHint || 'image.jpg';
                break;
            case 'video':
                payload.video = isHttp ? (body.includes('?') ? `${body}&ext=.mp4` : `${body}?ext=.mp4`) : deliveryBody;
                if (extraParams.caption) payload.caption = extraParams.caption;
                if (!isHttp) payload.filename = filenameHint || 'video.mp4';
                break;
            case 'audio':
            case 'voice':
                // Parameter name for both /audio and /voice is 'audio'
                payload.audio = isHttp ? (body.includes('?') ? (body.includes('.ogg') ? body : `${body}&ext=.ogg`) : (body.includes('.ogg') ? body : `${body}?ext=.ogg`)) : deliveryBody;

                // For /audio endpoint, ptt flag is needed. For /voice endpoint, it's implicit but good to have.
                if (endpoint === 'voice' || type === 'voice') {
                    payload.ptt = 'true';
                }

                if (!isHttp) {
                    payload.filename = filenameHint || (endpoint === 'voice' ? 'voice.ogg' : 'audio.mp3');
                }
                break;
            case 'document':
                payload.document = deliveryBody;
                payload.filename = filenameHint || extraParams.filename || 'document.pdf';
                break;
            default:
                payload.body = body;
        }

        const url = `https://api.ultramsg.com/${instanceId}/messages/${finalEndpoint}`;

        console.log(`🚀 [UltraMSG] EXECUTE: ${type} -> ${to} (Endpoint: ${finalEndpoint}, Format: ${isHttp ? 'URL' : (isDataUrl ? 'DATAURL' : 'BASE64')})`);
        if (!isHttp) {
            console.log(`📦 Payload Sample: ${String(deliveryBody).substring(0, 50)}...`);
        }

        if (!isHttp && deliveryBody.length > 500000) {
            console.warn(`⚠️ [UltraMSG] LARGE PAYLOAD: ${Math.round(deliveryBody.length / 1024)}KB.`);
        }

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
                await redis.set(debugKey, JSON.stringify({
                    timestamp: new Date().toISOString(),
                    duration,
                    status: response.status,
                    type,
                    endpoint: finalEndpoint,
                    payloadKeys: Object.keys(payload),
                    result: response.data
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
