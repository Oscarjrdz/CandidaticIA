import { getRedisClient, validateAdminSession } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(403).json({ error: 'Forbidden' });

    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Redis unavailable' });

    // 1. Remove 'colonia' from custom_fields
    const customFieldsJson = await redis.get('custom_fields');
    let removed = 0;
    if (customFieldsJson) {
        const fields = JSON.parse(customFieldsJson);
        const filtered = fields.filter(f => f.value !== 'colonia');
        removed = fields.length - filtered.length;
        await redis.set('custom_fields', JSON.stringify(filtered));
    }

    // 2. Delete all colonia_dir:* keys
    const keys = await redis.keys('colonia_dir:*');
    if (keys.length > 0) await redis.del(...keys);

    return res.status(200).json({
        ok: true,
        customFieldsRemoved: removed,
        coloniaKeysDeleted: keys.length,
    });
}
