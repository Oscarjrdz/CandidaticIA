import { getRedisClient } from './api/utils/storage.js';

async function checkCandData() {
    const redis = getRedisClient();
    if (!redis) { console.log('No redis'); return; }

    // Find candidate by phone suffix or just get latest active candidates
    const keys = await redis.keys('candidate:*');
    // Let's just find the one with 'Oscar' or recent interaction
    let targetId = null;
    let targetData = null;
    for (const key of keys) {
        const dataStr = await redis.get(key);
        if (dataStr && dataStr.includes('Oscar')) {
            targetId = key.replace('candidate:', '');
            targetData = JSON.parse(dataStr);
            break;
        }
    }

    if (!targetId) {
        console.log("Candidate not found");
        process.exit(0);
    }

    console.log("CANDIDATE DATA:", JSON.stringify(targetData, null, 2));

    // Check Project Metadata
    if (targetData.projectId) {
        const metaStr = await redis.hget(`project:cand_meta:${targetData.projectId}`, targetId);
        console.log("PROJECT META:", metaStr);
    }

    process.exit(0);
}
checkCandData();
