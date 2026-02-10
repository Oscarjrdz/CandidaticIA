import { getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('No Redis client');
        process.exit(1);
    }

    const allIds = await redis.zrevrange('candidates:list', 0, -1);
    const zcard = await redis.zcard('candidates:list');

    console.log(`ZCard: ${zcard}`);
    console.log(`IDs in list: ${allIds.length}`);

    let missingData = 0;
    let parseError = 0;
    let found = 0;

    const CHUNK_SIZE = 100;
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
        const chunk = allIds.slice(i, i + CHUNK_SIZE);
        const pipeline = redis.pipeline();
        chunk.forEach(id => pipeline.get(`candidate:${id}`));
        const results = await pipeline.exec();

        results.forEach(([err, res], idx) => {
            if (err || !res) {
                missingData++;
                console.log(`Orphan ID found: ${chunk[idx]}`);
            } else {
                try {
                    JSON.parse(res);
                    found++;
                } catch (e) {
                    parseError++;
                    console.log(`Parse Error ID: ${chunk[idx]}`);
                }
            }
        });
    }

    console.log(`\nSummary:`);
    console.log(`- Found with data: ${found}`);
    console.log(`- Missing data (Orphan): ${missingData}`);
    console.log(`- Parse error: ${parseError}`);
    console.log(`- Total (zcard): ${zcard}`);

    process.exit(0);
}

diagnose();
