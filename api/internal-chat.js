/**
 * GET  /api/internal-chat        → last N messages
 * POST /api/internal-chat        → send a message (saves + pushes via SSE)
 */
import { getRedisClient } from './utils/storage.js';

const KEY = 'internal:messages';
const MAX = 100;

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    if (req.method === 'GET') {
        const raw = await redis.lrange(KEY, 0, MAX - 1);
        const messages = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean).reverse();
        return res.json({ success: true, messages });
    }

    if (req.method === 'POST') {
        const { userId, userName, role, content } = req.body;
        if (!userId || !content?.trim()) return res.status(400).json({ error: 'Faltan datos' });

        const msg = {
            id: `im_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            userId,
            userName,
            role: role || 'User',
            content: content.trim(),
            timestamp: new Date().toISOString(),
        };

        await redis.lpush(KEY, JSON.stringify(msg));
        await redis.ltrim(KEY, 0, MAX - 1);

        // Push to all SSE clients instantly
        redis.publish('channel:sse:updates', JSON.stringify({
            type: 'internal:message',
            data: msg,
        })).catch(() => {});

        return res.json({ success: true, message: msg });
    }

    return res.status(405).end();
}
