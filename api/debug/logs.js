import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const client = getRedisClient();
    if (!client) return res.status(500).json({ error: 'No Redis' });

    try {
        const logs = await client.lrange('telemetry:ai:events', 0, 49);
        const parsedLogs = logs.map(l => JSON.parse(l));

        return res.status(200).json({
            success: true,
            total: parsedLogs.length,
            logs: parsedLogs
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
