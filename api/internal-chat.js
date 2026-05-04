/**
 * GET  /api/internal-chat?userId=X  → messages for user X (direct + broadcast)
 * POST /api/internal-chat            → send message (to: userId | 'all')
 */
import { getRedisClient } from './utils/storage.js';

const KEY = 'internal:messages';
const MAX = 200;

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    if (req.method === 'GET') {
        // Accept whatsapp (preferred stable identity) or legacy userId
        const meId = req.query.whatsapp || req.query.userId;
        const raw = await redis.lrange(KEY, 0, MAX - 1);
        const all = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean).reverse();
        // Return only messages relevant to this user: broadcast + DMs to/from them
        const messages = meId
            ? all.filter(m => m.to === 'all' || m.from === meId || m.to === meId)
            : all;
        return res.json({ success: true, messages });
    }

    if (req.method === 'POST') {
        const { from, fromName, fromRole, to, toName, content } = req.body;
        if (!from || !content?.trim() || !to) return res.status(400).json({ error: 'Faltan datos' });

        const msg = {
            id: `im_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            from,
            fromName: fromName || 'Reclutador',
            fromRole: fromRole || 'User',
            to,           // userId or 'all'
            toName: toName || (to === 'all' ? 'Todos' : to),
            content: content.trim(),
            timestamp: new Date().toISOString(),
        };

        await redis.lpush(KEY, JSON.stringify(msg));
        await redis.ltrim(KEY, 0, MAX - 1);

        redis.publish('channel:sse:updates', JSON.stringify({
            type: 'internal:message',
            data: msg,
        })).catch(() => {});

        return res.json({ success: true, message: msg });
    }

    return res.status(405).end();
}
