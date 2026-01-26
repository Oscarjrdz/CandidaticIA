export default async function handler(req, res) {
    try {
        const { getRedisClient } = await import('../utils/storage.js');
        const client = getRedisClient();
        if (!client) return res.status(500).json({ status: 'error', reason: 'No Redis client' });

        const ping = await client.ping();
        const keysCount = await client.dbsize();

        return res.status(200).json({
            status: 'ok',
            ping,
            dbSize: keysCount,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message });
    }
}
