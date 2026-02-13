import { getRedisClient } from './utils/storage.js';

/**
 * ByPass Rules API - Management of automatic routing rules
 */
export default async function handler(req, res) {
    const redis = getRedisClient();
    const KEYS = {
        BYPASS_LIST: 'bypass:list',
        BYPASS_PREFIX: 'bypass:'
    };

    try {
        if (req.method === 'GET') {
            const { id } = req.query;

            if (id) {
                const rule = await redis.get(`${KEYS.BYPASS_PREFIX}${id}`);
                return res.status(200).json({ success: true, data: rule ? JSON.parse(rule) : null });
            }

            // Get all rules
            const ids = await redis.zrange(KEYS.BYPASS_LIST, 0, -1);
            if (ids.length === 0) return res.status(200).json({ success: true, data: [] });

            const rulesRaw = await redis.mget(ids.map(id => `${KEYS.BYPASS_PREFIX}${id}`));
            const rules = rulesRaw
                .filter(r => r !== null)
                .map(r => JSON.parse(r));

            return res.status(200).json({ success: true, data: rules });
        }

        if (req.method === 'POST') {
            const rule = req.body;
            if (!rule.name || !rule.projectId) {
                return res.status(400).json({ success: false, error: 'Name and ProjectId are required' });
            }

            const id = `bp_${Date.now()}`;
            const newRule = {
                ...rule,
                id,
                active: true,
                createdAt: new Date().toISOString()
            };

            await Promise.all([
                redis.set(`${KEYS.BYPASS_PREFIX}${id}`, JSON.stringify(newRule)),
                redis.zadd(KEYS.BYPASS_LIST, Date.now(), id)
            ]);

            return res.status(201).json({ success: true, data: newRule });
        }

        if (req.method === 'PUT') {
            const updates = req.body;
            if (!updates.id) return res.status(400).json({ success: false, error: 'ID is required' });

            const existingRaw = await redis.get(`${KEYS.BYPASS_PREFIX}${updates.id}`);
            if (!existingRaw) return res.status(404).json({ success: false, error: 'Rule not found' });

            const updatedRule = {
                ...JSON.parse(existingRaw),
                ...updates,
                updatedAt: new Date().toISOString()
            };

            await redis.set(`${KEYS.BYPASS_PREFIX}${updates.id}`, JSON.stringify(updatedRule));
            return res.status(200).json({ success: true, data: updatedRule });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ success: false, error: 'ID is required' });

            await Promise.all([
                redis.del(`${KEYS.BYPASS_PREFIX}${id}`),
                redis.zrem(KEYS.BYPASS_LIST, id)
            ]);

            return res.status(200).json({ success: true, message: 'Deleted' });
        }

        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);

    } catch (error) {
        console.error('ByPass API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
