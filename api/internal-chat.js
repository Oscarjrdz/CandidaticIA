/**
 * GET  /api/internal-chat?whatsapp=X  → broadcast + DMs for user X
 * POST /api/internal-chat              → send message (to: userId | 'all')
 *
 * Storage:
 *   internal:broadcast              → list of broadcast messages (all)
 *   internal:dm:{canonicalKey}      → list of DM messages per conversation pair
 *   internal:threads:{userId}       → set of partner IDs for this user
 */
import { getRedisClient } from './utils/storage.js';

const BROADCAST_KEY = 'internal:broadcast';
const MAX_BROADCAST = 100;
const MAX_DM = 100;
const THREADS_TTL = 86400 * 30; // 30 days

function canonicalKey(a, b) {
    return [a, b].sort().join(':');
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    if (req.method === 'GET') {
        const meId = req.query.whatsapp || req.query.userId;
        if (!meId) return res.status(400).json({ error: 'Missing identity' });

        const pipe = redis.pipeline();
        pipe.lrange(BROADCAST_KEY, 0, MAX_BROADCAST - 1);
        pipe.smembers(`internal:threads:${meId}`);
        const [broadcastRes, threadsRes] = await pipe.exec();

        const broadcastRaw = broadcastRes[1] || [];
        const partners = threadsRes[1] || [];

        // Fetch all DM threads in one pipeline
        let dmMessages = [];
        if (partners.length > 0) {
            const dmPipe = redis.pipeline();
            for (const partner of partners) {
                dmPipe.lrange(`internal:dm:${canonicalKey(meId, partner)}`, 0, MAX_DM - 1);
            }
            const dmResults = await dmPipe.exec();
            for (const result of dmResults) {
                if (result[1]) dmMessages.push(...result[1]);
            }
        }

        const parse = (raw) => {
            try { return JSON.parse(raw); } catch { return null; }
        };

        const all = [
            ...broadcastRaw.map(parse),
            ...dmMessages.map(parse),
        ].filter(Boolean);

        // Sort ascending by timestamp
        all.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

        // Respect per-user clearedAt (sent as query param)
        const clearedAt = req.query.clearedAt || null;
        const messages = clearedAt
            ? all.filter(m => (m.timestamp || '') > clearedAt)
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
            to,
            toName: toName || (to === 'all' ? 'Todos' : to),
            content: content.trim(),
            timestamp: new Date().toISOString(),
        };

        const pipe = redis.pipeline();

        if (to === 'all') {
            pipe.lpush(BROADCAST_KEY, JSON.stringify(msg));
            pipe.ltrim(BROADCAST_KEY, 0, MAX_BROADCAST - 1);
        } else {
            const dmKey = `internal:dm:${canonicalKey(from, to)}`;
            pipe.lpush(dmKey, JSON.stringify(msg));
            pipe.ltrim(dmKey, 0, MAX_DM - 1);
            // Update thread index for both participants
            pipe.sadd(`internal:threads:${from}`, to);
            pipe.expire(`internal:threads:${from}`, THREADS_TTL);
            pipe.sadd(`internal:threads:${to}`, from);
            pipe.expire(`internal:threads:${to}`, THREADS_TTL);
        }

        await pipe.exec();

        // SSE notify — broadcast to all, clients filter on their end
        redis.publish('channel:sse:updates', JSON.stringify({
            type: 'internal:message',
            ...msg,
        })).catch(() => {});

        return res.json({ success: true, message: msg });
    }

    return res.status(405).end();
}
