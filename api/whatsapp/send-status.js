import axios from 'axios';
import { getRedisClient } from '../utils/storage.js';

const getApiBaseUrl = () => 'https://gatewaywapp-production.up.railway.app';

/**
 * POST /api/whatsapp/send-status
 * Publishes a WhatsApp Story/Status via GatewayWapp /{instanceId}/stories
 *
 * Text:  { token, type:'text',  text, color, font }
 * Image: { token, type:'image', image, caption }
 * Video: { token, type:'video', video, caption }
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let { instanceId, token, type = 'text', content, caption, color = '#075E54', font = 0 } = req.body;

    // Load creds from Redis if not passed
    if (!instanceId || !token) {
        try {
            const redis = getRedisClient();
            if (redis) {
                const instancesRaw = await redis.get('ultramsg_instances');
                if (instancesRaw) {
                    const instances = JSON.parse(instancesRaw);
                    const active = instances.find(i => i.status === 'active') || instances[0];
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
        } catch (e) { console.error('[send-status] Redis:', e.message); }
    }

    if (!instanceId || !token) return res.status(400).json({ success: false, error: 'Sin instancia configurada.' });
    if (!content) return res.status(400).json({ success: false, error: 'Contenido vacío.' });

    try {
        const baseUrl = getApiBaseUrl();
        const url = `${baseUrl}/${instanceId}/stories`;

        let payload = { token, type };

        if (type === 'text') {
            payload.text  = content;
            payload.color = color;
            payload.font  = parseInt(font);
        } else if (type === 'image') {
            payload.image   = content;
            payload.caption = caption || '';
        } else if (type === 'video') {
            payload.video   = content;
            payload.caption = caption || '';
        } else {
            return res.status(400).json({ success: false, error: `Tipo no soportado: ${type}` });
        }

        console.log(`[STORIES] POST ${url}  type=${type} instance=${instanceId}`);
        const response = await axios.post(url, payload, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
        });

        const success = response.status >= 200 && response.status < 300;
        console.log(`[STORIES] ${response.status}:`, JSON.stringify(response.data));
        return res.status(200).json({ success, data: response.data, httpStatus: response.status });
    } catch (e) {
        console.error('[STORIES] Error:', e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
}
