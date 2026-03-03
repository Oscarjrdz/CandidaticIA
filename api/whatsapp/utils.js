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
    try {
        const redis = getRedisClient();
        if (redis) {
            let config = await redis.get('ultramsg_credentials');
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
        if (!['chat', 'image', 'video', 'document', 'sticker', 'location'].includes(endpoint)) endpoint = 'chat';

        let formattedTo = String(to).trim();
        if (!formattedTo.includes('@')) {
            const cleanPhone = formattedTo.replace(/\D/g, '');
            formattedTo = `${cleanPhone}@c.us`;
        }

        const payload = {
            token,
            to: formattedTo,
            priority: extraParams.priority !== undefined ? extraParams.priority : 10 // Default to 10 for safety, but we'll use 0 for bots
        };
        const isHttp = typeof body === 'string' && body.startsWith('http');

        switch (endpoint) {
            case 'image':
                let imgUrl = body;
                if (isHttp && imgUrl.includes('/api/image?id=')) {
                    // Force production domain and correct image route instead of non-existent /api/media
                    imgUrl = imgUrl.replace(/^https?:\/\/[^\/]+(\/api\/image\?id=)([^&]+).*/, 'https://candidatic.ia/api/image?id=$2&ext=.jpg');
                    // Also handle cases where origin was somehow missing but contains the API path
                    if (imgUrl.startsWith('/api/')) imgUrl = `https://candidatic.ia${imgUrl}`;
                } else if (isHttp) {
                    imgUrl = imgUrl.includes('?') ? `${imgUrl}&ext=.jpg` : `${imgUrl}?ext=.jpg`;
                }
                payload.image = imgUrl;
                if (extraParams.caption) payload.caption = extraParams.caption;
                break;
            case 'video':
                payload.video = isHttp ? (body.includes('?') ? `${body}&ext=.mp4` : `${body}?ext=.mp4`) : body;
                if (extraParams.caption) payload.caption = extraParams.caption;
                break;
            case 'document':
                let docUrl = body;
                if (isHttp && docUrl.includes('/api/image?id=')) {
                    // Force production domain and correct image route for PDFs
                    docUrl = docUrl.replace(/^https?:\/\/[^\/]+(\/api\/image\?id=)([^&]+).*/, 'https://candidatic.ia/api/image?id=$2&ext=.pdf');
                    if (docUrl.startsWith('/api/')) docUrl = `https://candidatic.ia${docUrl}`;
                } else if (isHttp && !docUrl.includes('.pdf')) {
                    docUrl = docUrl.includes('?') ? `${docUrl}&ext=.pdf` : `${docUrl}?ext=.pdf`;
                }
                payload.document = docUrl;
                payload.filename = extraParams.filename || 'document.pdf';
                break;
            case 'sticker':
                payload.sticker = body;
                break;
            case 'location':
                payload.address = extraParams.address || body;
                payload.lat = extraParams.lat;
                payload.lng = extraParams.lng;
                break;
            default:
                const filterRegex = /^\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]$/i;
                const isTechnical = filterRegex.test(String(body).trim());

                if (isTechnical) {
                    console.log(`[ULTRAMSG FILTER] Blocking technical message send: "${body}"`);
                    return { success: true, data: { status: 'filtered_internal_tag' } };
                }
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
                validateStatus: (status) => true
            });
            const duration = Date.now() - startTime;

            if (redis) {
                const sanitizedPayload = { ...payload };
                if (sanitizedPayload.token) sanitizedPayload.token = '***_masked_***';

                // Fire and forget to save latency
                redis.set(debugKey, JSON.stringify({
                    timestamp: new Date().toISOString(),
                    duration,
                    status: response.status,
                    type,
                    endpoint: endpoint,
                    fullPayload: sanitizedPayload,
                    result: response.data
                }), 'EX', 3600).catch(() => { });
            }

            if (response.status === 200) {
                try {
                    const { incrementMessageStats } = await import('../utils/storage.js');
                    incrementMessageStats('outgoing').catch(() => { }); // Fire and forget
                } catch (e) { }
            }

            return { success: response.status === 200, data: response.data };
        } catch (error) {
            console.error(`❌ UltraMSG [${type}] Connection Error:`, error.message);
            return { success: false, error: error.message };
        }
    } catch (outerError) {
        console.error('❌ sendUltraMsgMessage fatal error:', outerError.message);
        return { success: false, error: outerError.message };
    }
};

export const getUltraMsgContact = async (instanceId, token, chatId) => {
    try {
        let formattedChatId = String(chatId).trim();
        if (!formattedChatId.includes('@')) {
            formattedChatId = `${formattedChatId.replace(/\D/g, '')}@c.us`;
        }
        const url = `https://api.ultramsg.com/${instanceId}/contacts/image`;
        const response = await axios.get(url, {
            params: { token, chatId: formattedChatId },
            timeout: 10000
        });
        return response.data;
    } catch (e) { return null; }
};


export const sendUltraMsgReaction = async (instanceId, token, msgId, emoji) => {
    try {
        if (!msgId) return null;
        const url = `https://api.ultramsg.com/${instanceId}/messages/reaction`;
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('msgId', msgId);
        params.append('emoji', emoji);
        const response = await axios.post(url, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        return response.data;
    } catch (e) { return null; }
};

export const resolveUltraMsgJid = async (instanceId, token, phone) => {
    try {
        const cleanPhone = String(phone).replace(/\D/g, '');
        if (!cleanPhone) return null;
        const formats = [`${cleanPhone}@c.us`];
        if (cleanPhone.startsWith('521') && cleanPhone.length === 13) {
            formats.push(`52${cleanPhone.substring(3)}@c.us`);
        }
        if (cleanPhone.startsWith('52') && cleanPhone.length === 12) {
            formats.push(`521${cleanPhone.substring(2)}@c.us`);
        }
        for (const jid of formats) {
            try {
                const url = `https://api.ultramsg.com/${instanceId}/contacts/contact`;
                const response = await axios.get(url, { params: { token, chatId: jid }, timeout: 5000 });
                if (response.data && (response.data.name || response.data.id)) return jid;
            } catch (e) { }
        }
        return formats[0];
    } catch (e) { return null; }
};

export const blockUltraMsgContact = async (instanceId, token, chatId) => {
    try {
        const resolvedChatId = await resolveUltraMsgJid(instanceId, token, chatId);
        const finalChatId = resolvedChatId || chatId;
        const url = `https://api.ultramsg.com/${instanceId}/contacts/block`;
        const res = await axios.post(url, { token, chatId: finalChatId }, { timeout: 10000 });
        return { success: res.status === 200, data: res.data };
    } catch (e) { return { success: false, error: e.message }; }
};

export const unblockUltraMsgContact = async (instanceId, token, chatId) => {
    try {
        const resolvedChatId = await resolveUltraMsgJid(instanceId, token, chatId);
        const finalChatId = resolvedChatId || chatId;
        const url = `https://api.ultramsg.com/${instanceId}/contacts/unblock`;
        const res = await axios.post(url, { token, chatId: finalChatId }, { timeout: 10000 });
        return { success: res.status === 200, data: res.data };
    } catch (e) { return { success: false, error: e.message }; }
};
