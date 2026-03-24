import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

    try {
        if (req.method === 'GET') {
            const raw = await redis.get('ultramsg_instances');
            let instances = [];
            if (raw) {
                try { instances = JSON.parse(raw); } catch (e) {}
            }
            return res.status(200).json(instances);
        }

        if (req.method === 'POST') {
            const { instances } = req.body; // Array of objects 
            if (!Array.isArray(instances)) return res.status(400).json({ error: 'Invalid data' });
            
            await redis.set('ultramsg_instances', JSON.stringify(instances));
            return res.status(200).json({ success: true });
        }
        
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
