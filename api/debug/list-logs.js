import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const keys = await redis.keys('debug:agent:logs:*');

        const pipeline = redis.pipeline();
        keys.forEach(k => pipeline.lindex(k, 0)); // Get only latest log for each
        const latestLogs = await pipeline.exec();

        const summary = keys.map((k, i) => {
            const id = k.split(':').pop();
            try {
                const log = JSON.parse(latestLogs[i][1]);
                return {
                    id,
                    timestamp: log.timestamp,
                    msg: log.receivedMessage?.substring(0, 50),
                    uq: log.aiResult?.unanswered_question
                };
            } catch { return { id, error: 'parse error' }; }
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return res.status(200).json({
            success: true,
            count: keys.length,
            recent: summary.slice(0, 20)
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
