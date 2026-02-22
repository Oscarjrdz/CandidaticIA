import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const patterns = ['debug:*', 'candidatic:*', 'candidate:*', 'index:*', 'messages:*'];
        const results = {};

        for (const p of patterns) {
            const [cursor, keys] = await redis.scan('0', 'MATCH', p, 'COUNT', 50);
            results[p] = { count: keys.length, sample: keys.slice(0, 10) };
        }

        // Check specifically for Oscar's phone variations
        const phone = '8116038195';
        const phoneVariations = [phone, '52' + phone, '521' + phone];
        const phoneIndexMatches = {};

        const indexKeys = ['candidatic:phone_index', 'index:phone', 'phone:index'];
        for (const k of indexKeys) {
            const hash = await redis.hgetall(k);
            const matches = {};
            phoneVariations.forEach(v => {
                if (hash[v]) matches[v] = hash[v];
            });
            phoneIndexMatches[k] = matches;
        }

        return res.status(200).json({
            success: true,
            results,
            phoneIndexMatches,
            env: {
                REDIS_URL_SET: !!process.env.REDIS_URL,
                KV_URL_SET: !!process.env.KV_URL
            }
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
