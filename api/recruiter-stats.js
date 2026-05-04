/**
 * GET /api/recruiter-stats?date=YYYY-MM-DD
 * Returns daily activity stats for all recruiters.
 *
 * Metrics:
 *  - timeHuman       → time active in app (from presence heartbeats)
 *  - chatsVisited    → unique chats opened (from presence, regardless of reply)
 *  - chatsResponded  → unique chats where recruiter sent ≥1 message (from chat POST)
 *  - messagesSent    → total messages sent (from chat POST)
 *  - chatsIn24h      → unique chats responded within Meta 24h window
 *  - chatsOut24h     → unique chats responded outside Meta 24h window
 */
import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    const date = req.query.date || new Date().toISOString().split('T')[0];

    try {
        const [timeKeys, msgKeys, visitedKeys, respondedKeys] = await Promise.all([
            redis.keys(`recruiter:time:*:${date}`),
            redis.keys(`recruiter:msgs:*:${date}`),
            redis.keys(`recruiter:visited:*:${date}`),
            redis.keys(`recruiter:chats:*:${date}`),
        ]);

        const userIds = new Set();
        const extractId = (key, prefix) => key.slice(prefix.length, key.lastIndexOf(':'));
        timeKeys.forEach(k => userIds.add(extractId(k, 'recruiter:time:')));
        msgKeys.forEach(k => userIds.add(extractId(k, 'recruiter:msgs:')));
        visitedKeys.forEach(k => userIds.add(extractId(k, 'recruiter:visited:')));
        respondedKeys.forEach(k => userIds.add(extractId(k, 'recruiter:chats:')));

        if (userIds.size === 0) return res.json({ success: true, date, stats: [] });

        const stats = await Promise.all([...userIds].map(async (userId) => {
            const [meta, timeVal, msgsVal, visited, responded, win24, out24] = await Promise.all([
                redis.get(`recruiter:meta:${userId}`),
                redis.get(`recruiter:time:${userId}:${date}`),
                redis.get(`recruiter:msgs:${userId}:${date}`),
                redis.scard(`recruiter:visited:${userId}:${date}`),  // opened, may not have replied
                redis.scard(`recruiter:chats:${userId}:${date}`),    // actually sent a message
                redis.scard(`recruiter:win24:${userId}:${date}`),
                redis.scard(`recruiter:out24:${userId}:${date}`),
            ]);

            const { userName = userId, role = '' } = meta ? JSON.parse(meta) : {};
            const seconds = parseInt(timeVal) || 0;
            const messages = parseInt(msgsVal) || 0;

            return {
                userId,
                userName,
                role,
                timeSeconds: seconds,
                timeHuman: fmtTime(seconds),
                chatsVisited: visited || 0,
                chatsResponded: responded || 0,   // consistent with messagesSent
                messagesSent: messages,
                chatsIn24h: win24 || 0,
                chatsOut24h: out24 || 0,
            };
        }));

        stats.sort((a, b) => b.timeSeconds - a.timeSeconds);
        return res.json({ success: true, date, stats });
    } catch (e) {
        console.error('[RECRUITER-STATS]', e);
        return res.status(500).json({ error: e.message });
    }
}

function fmtTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
