import { getRedisClient, getCandidates } from '../utils/storage.js';
import { getAllActiveInstances } from './utils.js';

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

        // Fetch ALL instances to revoke on every line
        const allInstances = await getAllActiveInstances();
        let instances = allInstances;
        
        // Fallback: try legacy single instance
        if (instances.length === 0) {
            try {
                const instancesRaw = await redis.get('ultramsg_instances');
                if (instancesRaw) {
                    const parsed = JSON.parse(instancesRaw);
                    const active = parsed.find(i => i.status === 'active') || parsed[0];
                    if (active) instances = [active];
                }
            } catch (e) {}
        }

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

        // 📡 DELETE on ALL instances
        const baseUrl = 'https://gatewaywapp-production.up.railway.app';
        const axios = (await import('axios')).default;
        for (const inst of instances) {
            if (!inst.instanceId || !inst.token) continue;
            const cleanInstanceId = inst.instanceId.replace(/^instance/, '');
            const url = `${baseUrl}/${cleanInstanceId}/stories/${id}`;
            try {
                await axios.delete(url, { 
                    data: { 
                        token: inst.token,
                        contacts
                    } 
                });
                console.log(`[WA DELETE STATUS] Revoked story ${id} on instance ${inst.instanceId}.`);
            } catch (gwError) {
                console.error(`[WA DELETE STATUS] Gateway error (${inst.instanceId}):`, gwError.response?.data || gwError.message);
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
