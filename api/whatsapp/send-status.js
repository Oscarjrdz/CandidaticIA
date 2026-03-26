import axios from 'axios';
import { getRedisClient } from '../utils/storage.js';

const getApiBaseUrl = () => 'https://gatewaywapp-production.up.railway.app';

/**
 * POST /api/whatsapp/send-status
 * Publishes a WhatsApp Status (Story) via GatewayWapp.
 * Body: { instanceId, token, type, content, caption, backgroundColor, font }
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let { instanceId, token, type = 'text', content, caption, backgroundColor = '#075E54', font = 0 } = req.body;

    // If no instanceId/token passed, load from Redis
    if (!instanceId || !token) {
        try {
            const redis = getRedisClient();
            if (redis) {
                const instancesRaw = await redis.get('ultramsg_instances');
                if (instancesRaw) {
                    const instances = JSON.parse(instancesRaw);
                    const active = instances.find(i => i.status === 'active' || i.instanceId) || instances[0];
                    if (active) { instanceId = active.instanceId; token = active.token; }
                }
                if (!instanceId) {
                    const cfg = await redis.get('ultramsg_credentials') || await redis.get('ultramsg_config');
                    if (cfg) {
                        const parsed = typeof cfg === 'string' ? JSON.parse(cfg) : cfg;
                        instanceId = parsed.instanceId;
                        token = parsed.token;
                    }
                }
            }
        } catch (e) { console.error('Redis config load error:', e.message); }
    }

    if (!instanceId || !token) {
        return res.status(400).json({ success: false, error: 'No hay instancia de WhatsApp configurada.' });
    }

    if (!content) {
        return res.status(400).json({ success: false, error: 'El contenido del estado no puede estar vacío.' });
    }

    try {
        const baseUrl = getApiBaseUrl();
        let endpoint, payload;

        if (type === 'text') {
            // Text status
            endpoint = `${baseUrl}/${instanceId}/statuses/text`;
            payload = { token, text: content, backgroundColor, font: parseInt(font) };
        } else if (type === 'image') {
            // Image status  
            endpoint = `${baseUrl}/${instanceId}/statuses/image`;
            payload = { token, image: content, caption: caption || '' };
        } else if (type === 'video') {
            // Video status
            endpoint = `${baseUrl}/${instanceId}/statuses/video`;
            payload = { token, video: content, caption: caption || '' };
        } else {
            return res.status(400).json({ success: false, error: `Tipo no soportado: ${type}` });
        }

        console.log(`[SEND STATUS] type=${type} instance=${instanceId}`);
        const response = await axios.post(endpoint, payload, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
        });

        const success = response.status >= 200 && response.status < 300;
        return res.status(200).json({
            success,
            data: response.data,
            httpStatus: response.status,
        });
    } catch (e) {
        console.error('[SEND STATUS] Error:', e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
}
