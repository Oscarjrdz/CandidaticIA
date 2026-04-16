/**
 * Chat Stats API — Ultra-fast unread count + active locks
 * GET /api/chat-stats → { unreadCount, unreadIds, locks }
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { getRedisClient, getCandidates } = await import('./utils/storage.js');

        if (req.method === 'GET') {
            const redis = getRedisClient();
            if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

            // 1. Get all candidates and count unreads
            const { candidates } = await getCandidates(5000);
            const unreadCandidates = candidates.filter(c => c.unread === true);
            const unreadCount = unreadCandidates.length;
            const unreadIds = unreadCandidates.map(c => c.id);

            // 2. Get active chat locks
            const lockKeys = await redis.keys('chat_lock:*');
            const locks = {};
            if (lockKeys.length > 0) {
                const pipeline = redis.pipeline();
                lockKeys.forEach(k => pipeline.get(k));
                const results = await pipeline.exec();
                lockKeys.forEach((k, i) => {
                    const candidateId = k.replace('chat_lock:', '');
                    const val = results[i][1];
                    if (val) {
                        try {
                            locks[candidateId] = JSON.parse(val);
                        } catch {
                            locks[candidateId] = { user: val };
                        }
                    }
                });
            }

            return res.status(200).json({
                success: true,
                unreadCount,
                unreadIds,
                locks
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Chat Stats Error:', error);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
