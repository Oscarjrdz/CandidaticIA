import axios from 'axios';
import { getRedisClient, getCandidates } from '../utils/storage.js';

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

    // Ensure we send the raw ID to the gateway (e.g. 9056d7014d instead of instance9056d7014d)
    const cleanInstanceId = instanceId.replace(/^instance/, '');

    try {
        const baseUrl = getApiBaseUrl();
        const url = `${baseUrl}/${cleanInstanceId}/stories`;

        // 🟢 PREPARE CONTACTS (Audiencia)
        // Fetches up to 2000 candidates to build a recipient list
        let contacts = [];
        try {
            const { candidates } = await getCandidates(2000, 0);
            if (candidates && Array.isArray(candidates)) {
                contacts = candidates
                    .map(c => c.phone || c.id || '')
                    .map(p => p.replace(/\D/g, ''))
                    // Asegurar que tengan el C.D. si no lo tienen (México = 52)
                    .map(p => p.length === 10 ? `52${p}` : p)
                    .filter(p => p.length >= 10);
            }
        } catch (e) {
            console.error('[send-status] Error fetching candidates for audience:', e.message);
        }

        // Always include admin numbers to force decryption on host device
        const testNumbers = ['528116038195', '5218116038195']; 
        testNumbers.forEach(num => {
            if (!contacts.includes(num)) contacts.push(num);
        });

        let payload = { token, type, contacts };

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

        if (success) {
            try {
                const redis = getRedisClient();
                if (redis) {
                    await redis.set('last_wa_status', JSON.stringify({
                        type,
                        content,
                        caption,
                        color,
                        font,
                        timestamp: new Date().toISOString()
                    }));
                }
            } catch (err) {
                console.error('[STORIES] Error saving last status to redis:', err.message);
            }
        }

        return res.status(200).json({ success, data: response.data, httpStatus: response.status });
    } catch (e) {
        console.error('[STORIES] Error:', e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
}
