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

            // Get active chat locks (KEYS is fine here — typically < 10 keys)
            pipeline.keys('chat_lock:*');
            pipeline.get('stats:bot:unread_v2');
            
            const results = await pipeline.exec();
            
            const lockKeys = results[0][1] || [];
            const unreadCountStr = results[1][1] || '0';
            const unreadCount = parseInt(unreadCountStr) || 0;

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
                locks
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Chat Stats Error:', error);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
