import axios from 'axios';
import { getRedisClient, getCandidates } from '../utils/storage.js';
import { getAllActiveInstances } from './utils.js';

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

    // Load creds from Redis if not passed — now supports multi-instance
    let targetInstances = []; // Will hold { instanceId, token } objects
    if (instanceId && token) {
        // Explicit credentials passed — use only this one
        targetInstances = [{ instanceId, token }];
    } else {
        // Broadcast through ALL instances for maximum story reach
        const allInstances = await getAllActiveInstances();
        if (allInstances.length > 0) {
            targetInstances = allInstances.map(i => ({ instanceId: i.instanceId, token: i.token }));
        } else {
            // Legacy fallback
            try {
                const redis = getRedisClient();
                if (redis) {
                    const cfg = await redis.get('ultramsg_credentials') || await redis.get('ultramsg_config');
                    if (cfg) {
                        const parsed = typeof cfg === 'string' ? JSON.parse(cfg) : cfg;
                        if (parsed.instanceId && parsed.token) {
                            targetInstances = [{ instanceId: parsed.instanceId, token: parsed.token }];
                        }
                    }
                }
            } catch (e) { console.error('[send-status] Redis:', e.message); }
        }
    }

    if (targetInstances.length === 0) return res.status(400).json({ success: false, error: 'Sin instancia configurada.' });
    if (!content) return res.status(400).json({ success: false, error: 'Contenido vacío.' });

    // Ensure we send the raw ID to the gateway (e.g. 9056d7014d instead of instance9056d7014d)
    const cleanInstanceId = instanceId.replace(/^instance/, '');

    try {
        const baseUrl = getApiBaseUrl();

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

        let payload = { type, contacts };

        if (type === 'text') {
            payload.text  = content;
            // Send exactly the Hex string (e.g. '#25D366') from UI 
            // since the Gateway explicitly deployed a regex hex-parser to transform it!
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

        // 📡 BROADCAST: Send through ALL instances
        let firstResponse = null;
        let successCount = 0;
        for (const inst of targetInstances) {
            const cleanId = inst.instanceId.replace(/^instance/, '');
            const url = `${baseUrl}/${cleanId}/stories`;
            try {
                const instPayload = { ...payload, token: inst.token };
                console.log(`[STORIES] POST ${url}  type=${type} instance=${inst.instanceId}`);
                const response = await axios.post(url, instPayload, {
                    timeout: 30000,
                    headers: { 'Content-Type': 'application/json' },
                    validateStatus: () => true,
                });
                const success = response.status >= 200 && response.status < 300;
                console.log(`[STORIES] ${response.status} (${inst.instanceId}):`, JSON.stringify(response.data));
                if (success) {
                    successCount++;
                    if (!firstResponse) firstResponse = response;
                }
            } catch (instErr) {
                console.error(`[STORIES] Error on instance ${inst.instanceId}:`, instErr.message);
            }
        }

        // Save to Redis using the first successful response
        if (firstResponse?.data?.id) {
            try {
                const redis = getRedisClient();
                if (redis) {
                    const storyObj = {
                        id: firstResponse.data.id,
                        type,
                        content,
                        caption,
                        color, // Store the original hex locally for frontend rendering
                        font,
                        timestamp: new Date().toISOString(),
                        views: [],
                        broadcastCount: successCount
                    };
                    await redis.lpush('wa_stories', JSON.stringify(storyObj));
                    
                    // Keep only the latest 30 stories to prevent unbound growth
                    await redis.ltrim('wa_stories', 0, 29);
                }
            } catch (err) {
                console.error('[STORIES] Error saving status to redis:', err.message);
            }
        }

        return res.status(200).json({ success: successCount > 0, broadcastCount: successCount, data: firstResponse?.data, httpStatus: firstResponse?.status });
    } catch (e) {
        console.error('[STORIES] Error:', e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
}
