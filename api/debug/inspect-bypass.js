import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) {
            return res.status(500).json({ error: 'No Redis connection' });
        }

        const traces = await redis.lrange('debug:bypass:traces', 0, 10);
        const parsedTraces = traces.map(t => JSON.parse(t));

        return res.status(200).json({
            success: true,
            traces: parsedTraces
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
