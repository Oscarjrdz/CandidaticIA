export default async function handler(req, res) {
    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();
        
        if (req.method === 'GET') {
            const raw = await redis.get('candidatic:chat_tags');
            const tags = raw ? JSON.parse(raw) : ['Urgente', 'Entrevista', 'Contratado', 'Rechazado', 'Duda'];
            return res.status(200).json({ success: true, tags });
        }
        
        if (req.method === 'POST') {
            const { tags } = req.body;
            await redis.set('candidatic:chat_tags', JSON.stringify(tags));
            return res.status(200).json({ success: true, tags });
        }
        
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
