import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const client = getRedisClient();
    const candId = await client.hget('idx:phones', '8116038195') || await client.hget('idx:phones', '5218116038195');
    console.log(`Candidate ID for admin: ${candId}`);
    if (candId) {
        const candStr = await client.get(`cand_${candId}`);
        console.log(candStr.substring(0, 200));
    }
    process.exit(0);
}
run();
