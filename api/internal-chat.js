/**
 * GET  /api/internal-chat?whatsapp=X  → broadcast + DMs for user X
 * POST /api/internal-chat              → send message (to: userId | 'all')
 *
 * Storage:
 *   internal:broadcast              → list of broadcast messages (all)
 *   internal:dm:{canonicalKey}      → list of DM messages per conversation pair
 *   internal:threads:{userId}       → set of partner IDs for this user
 */
import { getRedisClient, validateAdminSession } from './utils/storage.js';

const BROADCAST_KEY = 'internal:broadcast';
const MAX_BROADCAST = 100;
const MAX_DM = 100;
const THREADS_TTL = 86400 * 30; // 30 days

function canonicalKey(a, b) {
    return [a, b].sort().join(':');
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

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

        // Fetch statuses and reactions separately
        if (all.length > 0) {
            const metaPipe = redis.pipeline();
            all.forEach(m => metaPipe.get(`internal:status:${m.id}`));
            all.forEach(m => metaPipe.hgetall(`internal:reactions:${m.id}`));
            const metaResults = await metaPipe.exec();
            const half = all.length;
            all.forEach((m, i) => {
                const s = metaResults[i]?.[1];
                if (s) m.status = s;
                else if (!m.status) m.status = 'sent';
                m.reactions = metaResults[half + i]?.[1] || {};
            });
        }

        // Respect per-user clearedAt (sent as query param)
        const clearedAt = req.query.clearedAt || null;
        const messages = clearedAt
            ? all.filter(m => (m.timestamp || '') > clearedAt)
            : all;

        return res.json({ success: true, messages });
    }

    if (req.method === 'POST') {
        const { from, fromName, fromRole, to, toName, content, msgType } = req.body;
        if (!from || !content?.trim() || !to) return res.status(400).json({ error: 'Faltan datos' });

        // WebRTC signals: relay via SSE only, never store in Redis
        if (msgType?.startsWith('webrtc:')) {
            redis.publish('channel:sse:updates', JSON.stringify({
                type: 'internal:webrtc',
                from, fromName: fromName || 'Reclutador', to, content, msgType,
                timestamp: new Date().toISOString(),
            })).catch(() => {});
            return res.json({ success: true });
        }

        const msg = {
            id: `im_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            from,
            fromName: fromName || 'Reclutador',
            fromRole: fromRole || 'User',
            to,
            toName: toName || (to === 'all' ? 'Todos' : to),
            content: content.trim(),
            timestamp: new Date().toISOString(),
            status: 'sent',
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

    if (req.method === 'PATCH') {
        const { msgId, action, status, userId, emoji } = req.body;
        if (!msgId) return res.status(400).json({ error: 'Missing msgId' });

        if (action === 'react') {
            if (!userId) return res.status(400).json({ error: 'Missing userId' });
            const rKey = `internal:reactions:${msgId}`;
            if (!emoji) {
                await redis.hdel(rKey, userId);
            } else {
                await redis.hset(rKey, userId, emoji);
                await redis.expire(rKey, 86400 * 30);
            }
            const reactions = await redis.hgetall(rKey) || {};
            redis.publish('channel:sse:updates', JSON.stringify({
                type: 'internal:reaction',
                msgId,
                reactions,
            })).catch(() => {});
            return res.json({ success: true, reactions });
        }

        if (!['delivered', 'read'].includes(status))
            return res.status(400).json({ error: 'Invalid status' });

        await redis.set(`internal:status:${msgId}`, status, 'EX', 86400 * 30);

        redis.publish('channel:sse:updates', JSON.stringify({
            type: 'internal:status',
            msgId,
            status,
        })).catch(() => {});

        return res.json({ success: true });
    }

    return res.status(405).end();
}
