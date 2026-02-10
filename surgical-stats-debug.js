import { getRedisClient, isProfileComplete } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('No Redis client');
        process.exit(1);
    }

    const allIds = await redis.zrevrange('candidates:list', 0, -1);
    console.log(`Total IDs in ZSET: ${allIds.length}`);

    const customFieldsJson = await redis.get('custom_fields');
    const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

    let complete = 0;
    let pending = 0;
    let skippedNull = 0;
    let skippedParseErr = 0;
    let skippedLogicErr = 0;

    const skippedIds = [];

    const CHUNK_SIZE = 100;
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
        const chunk = allIds.slice(i, i + CHUNK_SIZE);
        const pipeline = redis.pipeline();
        chunk.forEach(id => pipeline.get(`candidate:${id}`));
        const results = await pipeline.exec();

        results.forEach(([err, res], idx) => {
            const id = chunk[idx];
            if (err || !res) {
                skippedNull++;
                skippedIds.push({ id, reason: 'Null or Err' });
                return;
            }

            try {
                const c = JSON.parse(res);
                try {
                    const isComp = isProfileComplete(c, customFields);
                    if (isComp) complete++;
                    else pending++;
                } catch (logicErr) {
                    skippedLogicErr++;
                    skippedIds.push({ id, reason: 'Logic Err', error: logicErr.message });
                }
            } catch (pErr) {
                skippedParseErr++;
                skippedIds.push({ id, reason: 'Parse Err', error: pErr.message });
            }
        });
    }

    console.log(`\nDetailed Summary:`);
    console.log(`- Complete: ${complete}`);
    console.log(`- Pending: ${pending}`);
    console.log(`- Sum: ${complete + pending}`);
    console.log(`- Discrepancy: ${allIds.length - (complete + pending)}`);
    console.log(`\nSkips:`);
    console.log(`- Null/Missing Key: ${skippedNull}`);
    console.log(`- Parse Errors: ${skippedParseErr}`);
    console.log(`- Logic/Audit Errors: ${skippedLogicErr}`);

    if (skippedIds.length > 0) {
        console.log(`\nSkipped IDs:`);
        console.log(JSON.stringify(skippedIds, null, 2));
    }

    process.exit(0);
}

diagnose();
