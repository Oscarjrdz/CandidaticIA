import { getRedisClient } from '../utils/storage.js';

/**
 * GET /api/whatsapp/get-status
 * Retorna la lista de los últimos estados publicados de WA
 * (Filtra los expirados mayores a 24h)
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Database unavailable' });

        // Retrieve raw items array from list
        let rawStories = await redis.lrange('wa_stories', 0, -1);
        if (!rawStories || rawStories.length === 0) {
            // Also check legacy string
            const legacyStatus = await redis.get('last_wa_status');
            if (legacyStatus) {
                const s = JSON.parse(legacyStatus);
                s.id = 'legacy_' + Date.now();
                s.views = [];
                await redis.lpush('wa_stories', JSON.stringify(s));
                rawStories = [JSON.stringify(s)];
                await redis.del('last_wa_status');
            } else {
                return res.json({ success: true, statuses: [] });
            }
        }

        const now = Date.now();
        const activeStories = [];
        const expiredIds = [];

        for (const item of rawStories) {
            try {
                const story = JSON.parse(item);
                const publishedAt = new Date(story.timestamp).getTime();
                const isExpired = (now - publishedAt) > (24 * 60 * 60 * 1000);
                
                if (isExpired) {
                    expiredIds.push(item);
                } else {
                    activeStories.push(story);
                }
            } catch (e) {
                // Remove corrupted JSON
                expiredIds.push(item);
            }
        }

        // Clean up expired ones from Redis list
        if (expiredIds.length > 0) {
            const pipeline = redis.pipeline();
            expiredIds.forEach(val => pipeline.lrem('wa_stories', 0, val));
            await pipeline.exec();
        }

        // Return active ones (newest first, since lpush creates newer at 0)
        return res.json({ success: true, statuses: activeStories });
    } catch (e) {
        console.error('[GET WA STATUS] Error:', e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
}
