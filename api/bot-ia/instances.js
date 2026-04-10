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

            // Hydrate from legacy config (Auto-Migration)
            if (!Array.isArray(instances) || instances.length === 0) {
                const legacyRaw = await redis.get('ultramsg_credentials') || await redis.get('ultramsg_config');
                if (legacyRaw) {
                    try { 
                        const legacy = JSON.parse(legacyRaw);
                        if (legacy && (legacy.instanceId || legacy.token)) {
                            instances = [{
                                id: Date.now().toString(),
                                name: legacy.name || 'Línea WhatsApp Principal',
                                identifier: legacy.identifier || 'CAND-01',
                                instanceId: legacy.instanceId || '',
                                token: legacy.token || '',
                                status: 'active'
                            }];
                            // Auto-save the migrated array
                            await redis.set('ultramsg_instances', JSON.stringify(instances));
                        }
                    } catch (e) {
                        console.error('Failed to parse legacy config', e);
                    }
                }
            }

            // Hydrate candidate counts per instance (fast scan)
            try {
                for (const inst of instances) {
                    const countKey = `instance_candidates:${inst.instanceId}`;
                    const count = await redis.get(countKey);
                    inst.candidateCount = count ? parseInt(count) : 0;
                }
            } catch (e) { /* non-critical */ }

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
