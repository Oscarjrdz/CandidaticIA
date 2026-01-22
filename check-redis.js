
import { getRedisClient } from './api/utils/storage.js';

async function check() {
    try {
        const redis = getRedisClient();
        if (!redis) {
            console.log('❌ Redis client not initialized (check REDIS_URL)');
            process.exit(1);
        }

        console.log('🔌 Connected to Redis');
        const config = await redis.get('ai_config');
        console.log('--- Current ai_config in Redis ---');
        console.log(config);

        const keys = await redis.keys('*');
        console.log('--- All Redis Keys ---');
        console.log(keys);

        process.exit(0);
    } catch (e) {
        console.error('❌ Error:', e.message);
        process.exit(1);
    }
}

// Small delay to allow ioredis to initialize if needed
setTimeout(check, 1000);
