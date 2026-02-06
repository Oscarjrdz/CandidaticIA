import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'No Redis client' });

        const keys = await redis.keys('messages:*');
        const results = [];
        const targets = ['preguntón', 'focusada', 'sigo aquí para ayudarte', 'procesa su perfil'];

        for (const key of keys) {
            const list = await redis.lrange(key, 0, -1);
            const newList = [];
            let removedCount = 0;

            for (const item of list) {
                const itemLower = item.toLowerCase();
                if (targets.some(t => itemLower.includes(t))) {
                    removedCount++;
                    continue; // Skip the ghost message
                }
                newList.push(item);
            }

            if (removedCount > 0) {
                // Atomic replace: delete and push all
                await redis.del(key);
                if (newList.length > 0) {
                    await redis.rpush(key, ...newList);
                }
                results.push({ key, removed: removedCount });
            }
        }

        return res.status(200).json({
            success: true,
            purged: results.length,
            details: results
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
