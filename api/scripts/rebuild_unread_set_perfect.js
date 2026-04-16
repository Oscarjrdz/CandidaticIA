import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
const isTLS = redisUrl.startsWith('rediss://');

const redis = new Redis(redisUrl, {
    tls: isTLS ? { rejectUnauthorized: false } : undefined
});

async function main() {
    console.log('🔄 Sincronizando SET de unreadIds con la base de datos JSON...');
    
    // Clear existing SET to rebuild it perfectly
    await redis.del('stats:unread:ids');
    
    // Get all candidate IDs that have ever messaged
    const keys = await redis.keys('candidate:*');
    console.log(`📊 Found ${keys.length} total candidates stored`);
    
    let unreadCount = 0;
    const batchSize = 200;
    
    for (let i = 0; i < keys.length; i += batchSize) {
        const batchKeys = keys.slice(i, i + batchSize);
        const pipeline = redis.pipeline();
        batchKeys.forEach(k => pipeline.get(k));
        const results = await pipeline.exec();
        
        const addPipeline = redis.pipeline();
        results.forEach(([err, raw], idx) => {
            if (err || !raw) return;
            try {
                const c = JSON.parse(raw);
                if (c.unread === true) {
                    const id = batchKeys[idx].replace('candidate:', '');
                    addPipeline.sadd('stats:unread:ids', id);
                    unreadCount++;
                }
            } catch {}
        });
        await addPipeline.exec();
    }
    
    console.log(`\n✅ SET reconstruido. Total actual de no leídos: ${unreadCount}`);
    
    // Verify
    const scard = await redis.scard('stats:unread:ids');
    console.log(`🔍 SCARD verification: ${scard}`);
    
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
