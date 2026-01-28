import { getRedisClient } from './api/utils/storage.js';

async function readLogs() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('❌ No Redis client');
        process.exit(1);
    }

    try {
        const logs = await redis.lrange('debug:extraction_log', 0, -1);
        logs.forEach((log, i) => {
            const entry = JSON.parse(log);
        });
        process.exit(0);
    } catch (err) {
        console.error('❌ Error reading logs:', err);
        process.exit(1);
    }
}

readLogs();
