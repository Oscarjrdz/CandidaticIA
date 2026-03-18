import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    try {
        const { phone } = req.query;
        if (!phone) return res.status(400).json({ error: 'Need phone' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'No redis' });

        const key = `debug:ultramsg:${phone}`;
        const data = await redis.get(key);
        
        let parsed = null;
        if (data) {
            try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
        }

        // Also fetch general logs
        const recentLogs = await redis.lrange('debug:agent:logs', 0, 5);

        return res.status(200).json({
            phone,
            key,
            ultraMsgVal: parsed || "Not found",
            recentLogs
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
