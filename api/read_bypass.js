import { getRedisClient } from './utils/storage.js';

async function main() {
    const redis = getRedisClient();
    if (!redis) { console.log("No redis"); return; }

    const isEnabled = await redis.get('bypass_enabled');
    console.log("bypass_enabled string:", isEnabled);

    const ids = await redis.zrange('bypass:list', 0, -1);
    console.log("bypass:list ids:", ids);

    if (ids.length > 0) {
        const rulesRaw = await redis.mget(ids.map(id => `bypass:${id}`));
        rulesRaw.forEach((r, i) => console.log(`Rule ${i}:`, r));
    }

    process.exit(0);
}
main();
