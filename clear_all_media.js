import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function clean() {
    try {
        let cursor = '0';
        let totalDeleted = 0;
        
        do {
            const result = await redis.scan(cursor, 'MATCH', '*image:*', 'COUNT', 100);
            cursor = result[0];
            const keys = result[1];
            
            if (keys.length > 0) {
                await redis.del(...keys);
                totalDeleted += keys.length;
            }
        } while (cursor !== '0');
        
        console.log(`Deleted ${totalDeleted} media keys from Redis.`);
        
        const info = await redis.info('memory');
        console.log('Memory Info:', info.split('\n').filter(line => line.startsWith('used_memory_human') || line.startsWith('maxmemory_human')));
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
clean();
