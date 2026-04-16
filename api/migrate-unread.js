/**
 * One-time migration endpoint: Sync 'stats:unread:ids' Redis SET
 * GET /api/migrate-unread → rebuilds the atomic SET from existing data
 * DELETE THIS FILE after running once in production.
 */

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        // Clear existing SET
        await redis.del('stats:unread:ids');

        // Get all candidate IDs
        const ids = await redis.zrange('candidates:list', 0, -1);

        let unreadCount = 0;
        const batchSize = 200;

        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            const pipeline = redis.pipeline();
            batch.forEach(id => pipeline.get(`candidate:${id}`));
            const results = await pipeline.exec();

            const addPipeline = redis.pipeline();
            results.forEach(([err, raw], idx) => {
                if (err || !raw) return;
                try {
                    const c = JSON.parse(raw);
                    if (c.unread === true) {
                        addPipeline.sadd('stats:unread:ids', batch[idx]);
                        unreadCount++;
                    }
                } catch {}
            });
            await addPipeline.exec();
        }

        return res.status(200).json({
            success: true,
            totalCandidates: ids.length,
            unreadCount,
            message: `SET 'stats:unread:ids' synced. Delete this endpoint now.`
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
