/**
 * Endpoint para manejar la presencia global de reclutadores y usuarios en línea.
 * Recibe un "heartbeat" cada ~8 segundos desde el cliente.
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
            const { userId, userName, role, currentChatId, idle } = req.body;
            
            if (!userId) {
                return res.status(400).json({ error: 'Missing userId' });
            }

            const activeKey = `presence:online:${userId}`;
            
            // Set data in Redis, expires in 12 seconds if no heartbeat received
            await redis.set(activeKey, JSON.stringify({
                userId,
                userName,
                role: role || 'User',
                currentChatId: currentChatId || null,
                lastSeen: Date.now()
            }), 'EX', 12);

            // ── Activity tracking (daily stats) ──────────────────────────────
            const today = new Date().toISOString().split('T')[0];
            const ttl = 86400 * 30; // keep 30 days
            const actPipe = redis.pipeline();
            // Store name/role for stats lookup
            actPipe.set(`recruiter:meta:${userId}`, JSON.stringify({ userName, role: role || 'User' }), 'EX', ttl);
            // Accumulate active seconds only when user is not idle
            if (!idle) {
                actPipe.incrby(`recruiter:time:${userId}:${today}`, 3);
                actPipe.expire(`recruiter:time:${userId}:${today}`, ttl);
            }
            // Track unique chats visited (opened, not necessarily responded)
            if (currentChatId) {
                actPipe.sadd(`recruiter:visited:${userId}:${today}`, currentChatId);
                actPipe.expire(`recruiter:visited:${userId}:${today}`, ttl);
            }
            actPipe.exec().catch(() => {});

            // Fetch all currently online users
            const allKeys = await redis.keys('presence:online:*');
            
            let onlineUsers = [];
            if (allKeys.length > 0) {
                // Redis pipeline to fetch all quickly
                const pipeline = redis.pipeline();
                allKeys.forEach(k => pipeline.get(k));
                const results = await pipeline.exec();
                
                results.forEach(val => {
                    if (val[1]) {
                        try {
                            onlineUsers.push(JSON.parse(val[1]));
                        } catch {}
                    }
                });
            }

            // Push live presence to all SSE clients so they update instantly
            redis.publish('channel:sse:updates', JSON.stringify({
                type: 'presence:update',
                data: { onlineUsers },
            })).catch(() => {});

            return res.status(200).json({ success: true, onlineUsers });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        console.error('Error Presence API:', e);
        return res.status(500).json({ error: 'Internal server error', details: e.message });
    }
}
