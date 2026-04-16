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
            const { userId, userName, role, currentChatId, avatarUrl } = req.body;
            
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

            return res.status(200).json({ success: true, onlineUsers });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        console.error('Error Presence API:', e);
        return res.status(500).json({ error: 'Internal server error', details: e.message });
    }
}
