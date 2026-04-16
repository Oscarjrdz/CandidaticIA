/**
 * Chat Stats API — O(1) unread count + active locks
 * GET /api/chat-stats → { unreadCount, locks }
 * 
 * Uses Redis SET 'stats:unread:ids' maintained atomically by updateCandidate()
 * instead of scanning all 5000 candidates every request.
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { getRedisClient } = await import('./utils/storage.js');

        if (req.method === 'GET') {
            const redis = getRedisClient();
            if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

            const pipeline = redis.pipeline();
            
            // 1. O(1) unread count from atomic SET
            pipeline.scard('stats:unread:ids');
            pipeline.smembers('stats:unread:ids');
            
            // 2. Get active chat locks (KEYS is fine here — typically < 10 keys)
            pipeline.keys('chat_lock:*');
            
            const results = await pipeline.exec();
            
            const unreadCount = results[0][1] || 0;
            const unreadIds = results[1][1] || [];
            const lockKeys = results[2][1] || [];

            // Resolve locks
            const locks = {};
            if (lockKeys.length > 0) {
                const lockPipeline = redis.pipeline();
                lockKeys.forEach(k => lockPipeline.get(k));
                const lockResults = await lockPipeline.exec();
                lockKeys.forEach((k, i) => {
                    const candidateId = k.replace('chat_lock:', '');
                    const val = lockResults[i][1];
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
