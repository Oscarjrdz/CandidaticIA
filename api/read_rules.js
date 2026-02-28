import { getRedisClient } from './utils/storage.js';

async function main() {
    const redis = getRedisClient();
    if(!redis) { console.log('no redis client'); return; }
    try {
        const rulesStr = await redis.get('bypass_rules');
        const rules = rulesStr ? JSON.parse(rulesStr) : [];
        console.log(JSON.stringify(rules, null, 2));
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
main();
