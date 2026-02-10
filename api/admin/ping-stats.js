import { getRedisClient } from '../utils/storage.js';
import { calculateBotStats } from '../utils/bot-stats.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis client failed' });

    const { refresh } = req.query;

    if (refresh === 'true') {
        await calculateBotStats();
    }

    const version = await redis.get('stats:bot:version');
    const complete = await redis.get('stats:bot:complete');
    const pending = await redis.get('stats:bot:pending');
    const total = await redis.get('stats:bot:total');

    return res.json({
        success: true,
        version: version || 'OLD-VERSION',
        stats: {
            complete: parseInt(complete || '0'),
            pending: parseInt(pending || '0'),
            total: parseInt(total || '0'),
            sum: parseInt(complete || '0') + parseInt(pending || '0')
        },
        match: (parseInt(complete || '0') + parseInt(pending || '0')) === parseInt(total || '0')
    });
}
