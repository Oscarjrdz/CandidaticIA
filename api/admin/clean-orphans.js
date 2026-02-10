import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const { secret } = req.query;
    if (secret !== 'cleanup_stats_99') return res.status(401).json({ error: 'Unauthorized' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis client failed' });

    try {
        const allIds = await redis.zrevrange('candidates:list', 0, -1);
        let orphans = [];

        const CHUNK_SIZE = 100;
        for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
            const chunk = allIds.slice(i, i + CHUNK_SIZE);
            const pipeline = redis.pipeline();
            chunk.forEach(id => pipeline.exists(`candidate:${id}`));
            const results = await pipeline.exec();

            results.forEach(([err, exists], idx) => {
                if (!err && exists === 0) {
                    orphans.push(chunk[idx]);
                }
            });
        }

        if (orphans.length > 0) {
            await redis.zrem('candidates:list', ...orphans);
        }

        return res.json({
            success: true,
            totalScanned: allIds.length,
            orphansFound: orphans.length,
            removedIds: orphans
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
