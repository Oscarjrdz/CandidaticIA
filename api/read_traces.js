import { getRedisClient, getCandidateByPhone } from './utils/storage.js';

async function main() {
    const redis = getRedisClient();
    if (!redis) { console.log('no redis'); process.exit(1); }

    const cand = await getCandidateByPhone('8116038195');
    if (!cand) { console.log('not found'); process.exit(0); }

    console.log("CANDIDATE STATE:", JSON.stringify(cand, null, 2));

    const traces = await redis.lrange('trace:ai:' + cand.id, 0, 5);
    console.log("\n=== AI TRACES ===");
    traces.reverse().forEach(t => console.log(typeof t === 'string' ? t : JSON.stringify(t)));

    process.exit(0);
}
main();
