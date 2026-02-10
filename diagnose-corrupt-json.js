import { getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('No Redis client');
        process.exit(1);
    }

    const allIds = await redis.zrevrange('candidates:list', 0, -1);
    console.log(`Scanning ${allIds.length} candidate IDs...`);

    let corrupt = [];
    let empty = [];

    const CHUNK_SIZE = 100;
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
        const chunk = allIds.slice(i, i + CHUNK_SIZE);
        const pipeline = redis.pipeline();
        chunk.forEach(id => pipeline.get(`candidate:${id}`));
        const results = await pipeline.exec();

        results.forEach(([err, res], idx) => {
            const id = chunk[idx];
            if (err) {
                console.log(`Error on ID ${id}: ${err.message}`);
                return;
            }
            if (!res) {
                // This shouldn't happen if clean-orphans said 0
                return;
            }

            try {
                JSON.parse(res);
            } catch (e) {
                if (res.trim() === '') {
                    empty.push(id);
                } else {
                    corrupt.push({ id, error: e.message, content: res.substring(0, 50) });
                }
            }
        });
    }

    console.log(`\nResults:`);
    console.log(`- Empty strings: ${empty.length}`);
    console.log(empty);
    console.log(`- Corrupt JSON: ${corrupt.length}`);
    console.log(corrupt);

    process.exit(0);
}

diagnose();
