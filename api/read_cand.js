import { getRedisClient } from './utils/storage.js';

async function main() {
    const redis = getRedisClient();
    if (!redis) return;

    const config = await redis.hgetall('config_admin');
    console.log("ALL CONFIG:", Object.keys(config));
    console.log("bypass_enabled is:", config.bypass_enabled);

    process.exit(0);
}
main();
