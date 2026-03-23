import { getRedisClient } from './api/utils/storage.js';

async function checkRedis() {
    process.env.DEBUG_MODE = 'true';
    const redis = getRedisClient();
    try {
        const info = await redis.info('memory');
        console.log("Redis Memory Info:\n", info);
        
        const keys = await redis.keys('image:*');
        console.log("Total image keys:", keys.length);
        
        const metas = await redis.keys('meta:image:*');
        console.log("Total meta keys:", metas.length);
        
    } catch(e) { console.error(e); }
    process.exit(0);
}
checkRedis();
