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
import { getRedisClient, validateAdminSession } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    const date = req.query.date || new Date().toISOString().split('T')[0];

    try {
        // Cache recruiter IDs for 60s; recruiter:ids:{date} is maintained by presence/chat writes.
        const cacheKey = `stats:recruiter:ids:${date}`;
        let userIds;
        const cached = await redis.get(cacheKey);
        if (cached) {
            userIds = new Set(JSON.parse(cached));
        } else {
            const indexedIds = await redis.smembers(`recruiter:ids:${date}`);
            userIds = new Set(indexedIds || []);
            if (userIds.size > 0) {
                await redis.set(cacheKey, JSON.stringify([...userIds]), 'EX', 60);
            }
        }

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
