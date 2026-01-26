import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const client = getRedisClient();
        if (!client) return res.status(500).json({ status: 'error', reason: 'No Redis client' });

        const ping = await client.ping();
        const keysCount = await client.dbsize();

        // Check for recent errors
        const errorKeys = await client.keys('debug:error:*');
        const errors = [];
        for (const key of errorKeys) {
            const val = await client.get(key);
            if (val) errors.push({ key, data: JSON.parse(val) });
        }

        return res.status(200).json({
            status: 'ok',
            version: '1.1.0-ferrari',
            ping,
            dbSize: keysCount,
            recentErrors: errors.slice(-10),
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message });
    }
}
