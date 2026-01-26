import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    // Basic security: require a secret or just allow it for now if it's a dev-only tool
    // In a real app, you'd check a session or a secret key in headers.

    try {
        const client = getRedisClient();
        if (!client) return res.status(500).json({ error: 'No Redis' });

        const keys = await client.keys('debug:ultramsg:*');
        const logs = [];

        for (const key of keys) {
            const data = await client.get(key);
            logs.push({
                key,
                data: JSON.parse(data)
            });
        }

        // Fetch media access logs
        const mediaLogsRaw = await client.lrange('debug:media_access', 0, 19);
        const mediaLogs = mediaLogsRaw.map(log => JSON.parse(log));

        return res.status(200).json({
            success: true,
            count: logs.length,
            logs: logs.slice(0, 20), // Last 20 logs
            mediaAccess: mediaLogs
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
