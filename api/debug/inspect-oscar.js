import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const candidateId = 'cand_1771740607320_w8sn1y0j9';

        // 1. Check Global Last Run
        const lastRunRaw = await redis.get('debug:global:last_run');
        const lastRun = lastRunRaw ? JSON.parse(lastRunRaw) : null;

        // 2. Check Candidate Messages
        const messages = await redis.lrange(`messages:${candidateId}`, -10, -1);
        const parsedMessages = messages.map(m => {
            try { return JSON.parse(m); } catch { return m; }
        });

        // 3. Check Candidate Traces
        const traceKey = `debug:agent:logs:${candidateId}`;
        const traceKeys = await redis.lrange(traceKey, 0, 9);
        const traces = traceKeys.map(t => {
            try { return JSON.parse(t); } catch { return t; }
        });

        // 4. Check for ANY debug keys
        const [cursor, anyDebug] = await redis.scan('0', 'MATCH', 'debug:*', 'COUNT', 100);

        return res.status(200).json({
            success: true,
            candidateId,
            lastGlobalRun: lastRun,
            anyDebugKeysFound: anyDebug,
            messages: parsedMessages,
            traces
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
