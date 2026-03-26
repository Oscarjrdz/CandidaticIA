import { getRedisClient, getCandidates } from '../utils/storage.js';

/**
 * DELETE /api/whatsapp/delete-status
 * Elimina un estado específico del listado del Dashboard.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

    const { id } = req.body || req.query;

    if (!id) return res.status(400).json({ error: 'Falta ID del estado' });

    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Database unavailable' });

        // Fetch credentials to talk to the Gateway
        let instanceId, token;
        try {
            const instancesRaw = await redis.get('ultramsg_instances');
            if (instancesRaw) {
                const instances = JSON.parse(instancesRaw);
                const active = instances.find(i => i.status === 'active') || instances[0];
                if (active) { instanceId = active.instanceId; token = active.token; }
            }
        } catch (e) {}

        const cleanInstanceId = instanceId ? instanceId.replace(/^instance/, '') : null;
        
        // Call the Gateway physical DELETE endpoint
        if (cleanInstanceId && token) {
            try {
                // Same audience assembly rule from creation (Contacts)
                let contacts = [];
                try {
                    const { candidates } = await getCandidates(2000, 0);
                    if (candidates && Array.isArray(candidates)) {
                        contacts = candidates
                            .map(c => c.phone || c.id || '')
                            .map(p => p.replace(/\D/g, ''))
                            .map(p => p.length === 10 ? `52${p}` : p)
                            .filter(p => p.length >= 10);
                    }
                } catch (e) { console.error('Error fetching candidates for DELETE audience:', e.message); }

                const testNumbers = ['528116038195', '5218116038195']; 
                testNumbers.forEach(num => { if (!contacts.includes(num)) contacts.push(num); });

                const baseUrl = 'https://gatewaywapp-production.up.railway.app';
                const url = `${baseUrl}/${cleanInstanceId}/stories/${id}`;
                
                const axios = (await import('axios')).default;
                
                await axios.delete(url, { 
                    data: { 
                        token,
                        contacts // MUST inject the audience for WhatsApp Server
                    } 
                });
                
                console.log(`[WA DELETE STATUS] Revoked story ${id} on Whatsapp Network.`);
            } catch (gwError) {
                console.error('[WA DELETE STATUS] Gateway side error:', gwError.response?.data || gwError.message);
            }
        }

        const rawStories = await redis.lrange('wa_stories', 0, -1);
        let removedCount = 0;
        
        const pipeline = redis.pipeline();
        
        for (const item of rawStories) {
            try {
                const story = JSON.parse(item);
                if (story.id === id) {
                    pipeline.lrem('wa_stories', 0, item);
                    removedCount++;
                }
            } catch (e) {}
        }
        
        if (removedCount > 0) {
            await pipeline.exec();
        }

        return res.json({ success: true, removed: removedCount });
    } catch (e) {
        console.error('[DELETE WA STATUS] Error:', e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
}
