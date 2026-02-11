
import Redis from 'ioredis';

async function listCandidates() {
    const redisUrl = process.env.REDIS_URL;
    // I hope I can get it if I run it in a way that has access... 
    // wait, I can't.
    // I'll try to use the storage.js which might have it if run via the same environment.

    try {
        const { getRedisClient } = await import('./api/utils/storage.js');
        const redis = getRedisClient();
        if (!redis) {
            console.error('❌ Redis client not available');
            return;
        }

        const keys = await redis.keys('candidate:*');
        console.log(`✅ Found ${keys.length} candidates`);

        for (const key of keys.slice(0, 20)) {
            const data = await redis.get(key);
            const candidate = JSON.parse(data);
            console.log(`- ID: ${candidate.id}, Nombre: ${candidate.nombre}, Phone: ${candidate.phone}, WhatsApp: ${candidate.whatsapp}, Blocked: ${candidate.blocked}`);
        }
    } catch (e) {
        console.error('❌ Error:', e.message);
    }
}

listCandidates();
