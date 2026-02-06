import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'No Redis client' });

        const keys = await redis.keys('*');
        const results = [];
        const targets = ['preguntón', 'santiago', 'ayudante', 'focusada'];

        for (const key of keys) {
            const value = await redis.get(key).catch(() => null);
            if (value && typeof value === 'string' && targets.some(t => value.toLowerCase().includes(t))) {
                results.push({ key, value: value.substring(0, 500) + '...' });
            }

            // Check hashes too
            const type = await redis.type(key);
            if (type === 'hash') {
                const hash = await redis.hgetall(key);
                for (const [f, v] of Object.entries(hash)) {
                    if (v && targets.some(t => v.toLowerCase().includes(t))) {
                        results.push({ key: `${key} -> ${f}`, value: v.substring(0, 500) + '...' });
                    }
                }
            }
        }

        return res.status(200).json({
            success: true,
            found: results.length,
            results
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
