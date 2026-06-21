import { getRedisClient, validateAdminSession } from './utils/storage.js';

export default async function handler(req, res) {
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const client = getRedisClient();
    if (!client) return res.status(500).json({ error: 'No Redis' });

    try {
        const instancePayloads = await client.lrange('debug:instance_payload_last', 0, 20);
        const webhookPayloads = await client.lrange('debug:webhook_payload_last', 0, 20); // if exists
        
        return res.status(200).json({
            instancePayloads: instancePayloads.map(p => JSON.parse(p)),
            webhookPayloads: webhookPayloads.map(p => JSON.parse(p))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
