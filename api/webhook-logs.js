import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const client = getRedisClient();
    if (!client) return res.status(500).json({ error: 'No Redis' });

    try {
        const historyRaw = await client.lrange('debug:webhook_history', 0, 50);
        const history = historyRaw.map(h => JSON.parse(h));
        
        return res.json({ history });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
