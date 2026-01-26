import { getRedisClient, getCandidateIdByPhone, getCandidateById } from './api/utils/storage.js';

async function diagnose() {
    console.log("🔍 Diagnosing Candidate 5218116038195...");

    const redis = getRedisClient();
    if (!redis) {
        console.error("❌ Redis client not available");
        process.exit(1);
    }

    console.log("🔌 Redis connected.");

    const phone = "5218116038195";

    // 1. Check Index
    const indexId = await redis.hget('candidatic:phone_index', phone);
    console.log(`📂 Index Check (candidatic:phone_index): ${indexId || 'NOT FOUND'}`);

    // 2. Check getCandidateIdByPhone logic
    const resolvedId = await getCandidateIdByPhone(phone);
    console.log(`🕵️ Resolved ID: ${resolvedId || 'NULL'}`);

    if (resolvedId) {
        const candidate = await getCandidateById(resolvedId);
        console.log("👤 Candidate Data:", JSON.stringify(candidate, null, 2));
    } else {
        console.log("⚠️ Candidate ID not resolved. Checking raw ZSET...");
        const list = await redis.zrange('candidates:list', 0, -1);
        console.log(`📚 Total candidates in ZSET: ${list.length}`);

        // Scan for phone manually
        for (const id of list) {
            const data = await redis.get(`candidate:${id}`);
            if (data && data.includes(phone)) {
                console.log(`🎯 FOUND in ZSET scan! ID: ${id}`);
                console.log(data);
                break;
            }
        }
    }

    process.exit(0);
}

diagnose();
