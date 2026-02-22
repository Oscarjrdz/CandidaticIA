import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const candidateId = 'cand_1771740607320_w8sn1y0j9';
        const messages = await redis.lrange(`messages:${candidateId}`, -5, -1);
        const parsedMessages = messages.map(m => {
            try { return JSON.parse(m); } catch { return m; }
        });

        const candidate = await redis.get(`candidate:${candidateId}`);
        const parsedCandidate = candidate ? JSON.parse(candidate) : null;

        return res.status(200).json({
            success: true,
            candidateId,
            messages: parsedMessages,
            candidateData: parsedCandidate
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
