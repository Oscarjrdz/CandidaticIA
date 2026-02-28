import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).send("No Redis");

        const dbTraces = await redis.lrange('debug:bypass:traces', 0, 10);
        const parsed = dbTraces.map(t => JSON.parse(t));

        res.status(200).json(parsed);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
