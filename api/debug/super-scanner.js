import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'No Redis client' });

        const keys = await redis.keys('*');
        const results = [];
        const targets = ['santiago', 'ayudante', 'preguntón', 'focusada'];

        for (const key of keys) {
            try {
                const type = await redis.type(key);
                let found = false;
                let value = null;

                if (type === 'string') {
                    value = await redis.get(key);
                    if (value && targets.some(t => value.toLowerCase().includes(t))) found = true;
                } else if (type === 'hash') {
                    value = await redis.hgetall(key);
                    const stringified = JSON.stringify(value).toLowerCase();
                    if (targets.some(t => stringified.includes(t))) found = true;
                } else if (type === 'list') {
                    const list = await redis.lrange(key, 0, -1);
                    const stringified = JSON.stringify(list).toLowerCase();
                    if (targets.some(t => stringified.includes(t))) found = true;
                    value = `List with ${list.length} items`;
                } else if (type === 'set') {
                    const set = await redis.smembers(key);
                    const stringified = JSON.stringify(set).toLowerCase();
                    if (targets.some(t => stringified.includes(t))) found = true;
                    value = `Set with ${set.length} members`;
                }

                if (found) {
                    results.push({ key, type, value });
                }
            } catch (e) {
                console.error(`Error scanning key ${key}:`, e.message);
            }
        }

        // Also get Oscar's candidate data specifically for debugging context
        const oscarId = await redis.hget('candidatic:phone_index', '5218116038195');
        const oscarData = oscarId ? await redis.get(`candidate:${oscarId}`) : null;

        return res.status(200).json({
            success: true,
            found: results.length,
            oscarCandidate: oscarData ? JSON.parse(oscarData) : 'Not found',
            results
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
