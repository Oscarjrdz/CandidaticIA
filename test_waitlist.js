import { getRedisClient } from './api/utils/storage.js';

async function checkWaitlist() {
    const redis = getRedisClient();
    const cursor = '0';
    let keys = [];
    try {
        keys = await redis.keys('waitlist:*');
        for (const k of keys) {
            const len = await redis.llen(k);
            if(len > 0) {
                console.log(k, len, "items");
                const items = await redis.lrange(k, 0, -1);
                console.log(items);
            }
        }
    } catch(e) {}
    process.exit(0);
}
checkWaitlist();
