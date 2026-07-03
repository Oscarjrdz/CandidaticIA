import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'no redis' });

    const phone = req.query.phone || '';
    if (!phone) {
        // List all debug keys
        const keys = await redis.keys('debug:meta_send*').catch(() => []);
        return res.json({ keys });
    }

    const latest = await redis.get(`debug:meta_send:${phone}`).catch(() => null);
    const log = await redis.lrange(`debug:meta_send_log:${phone}`, 0, 4).catch(() => []);
    return res.json({
        latest: latest ? JSON.parse(latest) : null,
        log: log.map(l => { try { return JSON.parse(l); } catch { return l; } })
    });
}
