export default async function handler(req, res) {
    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();
        const KEY = 'candidatic:quick_replies';

        if (req.method === 'GET') {
            const raw = await redis.get(KEY);
            const replies = raw ? JSON.parse(raw) : [];
            return res.status(200).json({ success: true, replies });
        }

        if (req.method === 'POST') {
            const { replies } = req.body;
            await redis.set(KEY, JSON.stringify(replies));
            return res.status(200).json({ success: true, replies });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
