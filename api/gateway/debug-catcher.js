export default async function handler(req, res) {
    try {
        const { getRedisClient } = await import('../utils/storage.js');
        const client = getRedisClient();
        if (!client) return res.status(500).json({error: 'Redis not configured'});
        
        const payloads = await client.lrange('debug:catcher_payload_last', 0, -1);
        res.status(200).json({ payloads: payloads.map(p => JSON.parse(p)) });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
}
