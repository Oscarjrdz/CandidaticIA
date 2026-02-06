import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'No Redis client' });

        const keys = await redis.keys('*');
        const results = [];
        const targets = ['preguntón', 'focusada', 'sigo aquí'];

        for (const key of keys) {
            const type = await redis.type(key);

            if (type === 'string') {
                const value = await redis.get(key).catch(() => null);
                if (value && targets.some(t => value.toLowerCase().includes(t))) {
                    results.push({ key, type: 'string', value: value.substring(0, 1000) });
                }
            }

            if (type === 'hash') {
                const hash = await redis.hgetall(key);
                for (const [f, v] of Object.entries(hash)) {
                    if (v && targets.some(t => v.toLowerCase().includes(t))) {
                        results.push({ key: `${key} -> ${f}`, type: 'hash_field', value: v.substring(0, 1000) });
                    }
                }
            }

            if (type === 'list') {
                const list = await redis.lrange(key, 0, -1);
                for (let i = 0; i < list.length; i++) {
                    const v = list[i];
                    if (v && targets.some(t => v.toLowerCase().includes(t))) {
                        results.push({ key: `${key} [item ${i}]`, type: 'list_item', value: v.substring(0, 1000) });
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
