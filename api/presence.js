/**
 * Endpoint para manejar la presencia global de reclutadores y usuarios en línea.
 * Recibe un heartbeat periódico desde el cliente.
 * 
 * POST /api/presence -> Guarda estado en Redis, retorna lista de conectados.
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();

        if (!redis) {
            return res.status(500).json({ error: 'Redis offline' });
        }

        if (req.method === 'POST') {
            const { userId, whatsapp, userName, role, currentChatId, idle, activeSeconds } = req.body;

            if (!userId) {
                return res.status(400).json({ error: 'Missing userId' });
            }

            // Use whatsapp as the canonical key when available (stable, no prefix ambiguity)
            const stableKey = whatsapp || userId;
            const now = Date.now();
            const PRESENCE_TTL_MS = 90000; // 90s — heartbeat cada 45s, TTL da margen para lag de red
            const expiresAt = now + PRESENCE_TTL_MS;

            // ── Write user state into Hash + Sorted Set (replaces individual SET with EX 12) ──
            // Hash: presence:hash  → field=stableKey, value=JSON
            // SortedSet: presence:expiry → member=stableKey, score=expiresAt timestamp
            const userState = JSON.stringify({
                userId: stableKey,
                whatsapp: whatsapp || null,
                userName,
                role: role || 'User',
                currentChatId: currentChatId || null,
                lastSeen: now
            });

            const writePipe = redis.pipeline();
            writePipe.hset('presence:hash', stableKey, userState);
            writePipe.zadd('presence:expiry', expiresAt, stableKey);
            await writePipe.exec();

            // ── Activity tracking (daily stats) ──────────────────────────────
            const today = new Date().toISOString().split('T')[0];
            const ttl = 86400 * 30; // keep 30 days
            const actPipe = redis.pipeline();
            // Store name/role for stats lookup
            actPipe.set(`recruiter:meta:${userId}`, JSON.stringify({ userName, role: role || 'User' }), 'EX', ttl);
            // Accumulate active seconds only when user is not idle
            if (!idle) {
                const seconds = Math.max(0, Math.min(Number(activeSeconds) || 3, 60));
                actPipe.incrby(`recruiter:time:${userId}:${today}`, seconds);
                actPipe.expire(`recruiter:time:${userId}:${today}`, ttl);
            }
            // Track unique chats visited (opened, not necessarily responded)
            if (currentChatId) {
                actPipe.sadd(`recruiter:visited:${userId}:${today}`, currentChatId);
                actPipe.expire(`recruiter:visited:${userId}:${today}`, ttl);
            }
            actPipe.exec().catch(() => {});

            // ── Build online users list: prune expired, then read all ─────────
            // Remove members whose expiresAt score < now (they haven't heartbeated in 12s)
            await redis.zremrangebyscore('presence:expiry', '-inf', now - 1);

            // Get surviving members
            const activeKeys = await redis.zrange('presence:expiry', 0, -1);

            let onlineUsers = [];
            if (activeKeys.length > 0) {
                const rawValues = await redis.hmget('presence:hash', ...activeKeys);
                rawValues.forEach(val => {
                    if (val) {
                        try { onlineUsers.push(JSON.parse(val)); } catch {}
                    }
                });
            }

            // ── Conditional SSE publish: only when the user list actually changes ──
            // Compare sorted user presence state to detect additions/removals and chat switches.
            const { createHash } = await import('crypto');
            const listHash = createHash('md5')
                .update(onlineUsers.map(u => `${u.userId}:${u.currentChatId || ''}`).sort().join(','))
                .digest('hex');
            const prevHash = await redis.get('presence:last_hash');

            if (listHash !== prevHash) {
                await redis.set('presence:last_hash', listHash, 'EX', 30);
                redis.publish('channel:sse:updates', JSON.stringify({
                    type: 'presence:update',
                    onlineUsers,
                })).catch(() => {});
            }

            if (req.query.lean === '1') {
                return res.status(200).json({ success: true });
            }

            return res.status(200).json({ success: true, onlineUsers });
        }


        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        console.error('Error Presence API:', e);
        return res.status(500).json({ error: 'Internal server error', details: e.message });
    }
}
