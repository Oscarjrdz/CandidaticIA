import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const redis = getRedisClient();
    if (!redis) {
        console.log('No redis client');
        process.exit(1);
    }

    try {
        console.log('--- RECENT ACTIVITY SCAN ---');
        const keys = await redis.keys('debug:agent:logs:*');
        console.log(`Found ${keys.length} log keys.`);

        const pipeline = redis.pipeline();
        keys.forEach(k => pipeline.llen(k));
        const lengths = await pipeline.exec();

        const activity = keys.map((k, i) => ({
            key: k,
            len: lengths[i][1]
        })).sort((a, b) => b.len - a.len).slice(0, 10);

        console.log('Top 10 active candidates:');
        activity.forEach(a => console.log(`${a.key} | logs: ${a.len}`));

        // Check for specific phone in phone index again
        const phoneIndex = await redis.hgetall('candidatic:phone_index');
        console.log('Total entries in phone index:', Object.keys(phoneIndex).length);
        const myId = phoneIndex['8116038195'] || phoneIndex['528116038195'] || phoneIndex['5218116038195'];
        console.log('ID for phone 8116038195:', myId);

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

run();
