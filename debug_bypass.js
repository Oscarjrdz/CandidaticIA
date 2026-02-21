import { getRedisClient } from './api/utils/storage.js';

async function check() {
    const redis = getRedisClient();
    const traces = await redis.lrange('debug:bypass:traces', 0, 5);
    console.log(JSON.stringify(traces.map(t => JSON.parse(t)), null, 2));
    process.exit(0);
}
check();
