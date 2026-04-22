const { getRedisClient } = require('./api/utils/storage.js');
async function test() {
    const redis = getRedisClient();
    const keys = await redis.keys('candidate:*');
    if (keys.length > 0) {
        const c1 = await redis.get(keys[0]);
        console.log("Candidate 1:", c1);
        const c2 = await redis.get(keys[keys.length-1]);
        console.log("Candidate N:", c2);
    }
    process.exit(0);
}
test();
