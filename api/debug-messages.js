
import { getRedisClient, getCandidates } from './utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) {
            return res.status(500).json({ error: 'No Redis client' });
        }

        // Get recent candidates to find a target
        const { candidates } = await getCandidates(10);

        const debugData = [];

        for (const c of candidates) {
            const key = `messages:${c.id}`;
            const rawMessages = await redis.lrange(key, 0, -1);
            const messages = rawMessages.map(m => {
                try { return JSON.parse(m); } catch { return m; }
            });

            debugData.push({
                candidate: { nombre: c.nombre, whatsapp: c.whatsapp, id: c.id },
                messageCount: messages.length,
                messages: messages.slice(-5) // Show last 5
            });
        }

        return res.status(200).json({
            status: 'ok',
            data: debugData
        });

    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message,
            stack: error.stack
        });
    }
}
