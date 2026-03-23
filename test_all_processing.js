import { getRedisClient } from './api/utils/storage.js';

async function queryRedis() {
    const redis = getRedisClient();
    const l = await redis.lrange('telemetry_logs_v4', -200, -1);
    for (const log of l) {
        try {
            const j = JSON.parse(log);
            if (j.type === 'PROCESSING_START' || j.type === 'AI_COMPLETE') {
                if (j.timestamp.includes('01:22') || j.timestamp.includes('01:23')) {
                    console.log(j.timestamp, j.type, j.data?.candidateId);
                }
            } else if (j.type === 'AI_ERROR' || j.type === 'ERROR') {
                console.log(j.timestamp, j.type, j.data?.error);
            }
        } catch(e) {}
    }
    process.exit(0);
}
queryRedis();
