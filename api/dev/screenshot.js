import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    // Only allow in dev/internal context
    const secret = req.headers['x-dev-secret'] || req.query.secret;
    if (secret !== 'candidatic_dev_2026') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    const url = await redis.get('dev_last_screenshot');
    return res.status(200).json({ url: url || null });
}
