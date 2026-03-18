import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const client = getRedisClient();
        if (!client) {
            return res.status(500).json({ error: 'No Redis client connected' });
        }

        const limit = parseInt(req.query.limit || '5', 10);
        const events = await client.lrange('telemetry:ai:events', 0, limit - 1);

        if (!events || events.length === 0) {
            return res.status(200).json({ message: 'No AI telemetry events found.' });
        }

        const parsedEvents = events.map(evStr => {
            try {
               return JSON.parse(evStr);
            } catch(e) {
               return { error: 'Parse failed', raw: evStr };
            }
        });

        res.status(200).json(parsedEvents);
    } catch (e) {
        console.error('Debug AI endpoint error:', e);
        res.status(500).json({ error: e.message });
    }
}
