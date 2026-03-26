import { getRedisClient } from '../utils/storage.js';

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
