import { getRedisClient } from './api/utils/storage.js';

async function checkFollowUps() {
    const redis = getRedisClient();
    const allIds = await redis.zrevrange('candidates:list', 0, 20);
    console.log(`Checking first ${allIds.length} candidates...`);

    for (const id of allIds) {
        const raw = await redis.get(`candidate:${id}`);
        if (raw) {
            const c = JSON.parse(raw);
            console.log(`Candidate ${c.nombre || c.id}: followUps = ${c.followUps} (type: ${typeof c.followUps})`);
        }
    }
}

checkFollowUps();
