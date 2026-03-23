import { getRedisClient } from './api/utils/storage.js';

async function queryRedis() {
    const redis = getRedisClient();
    const logsStr = await redis.lrange('telemetry_logs_v4', -100, -1);
    for(const lStr of logsStr) {
        try {
            const j = JSON.parse(lStr);
            if (j.type !== 'INGRESS') {
                console.log(j.timestamp, j.type, String(j.data?.candidateId || ''), j.data?.event, JSON.stringify(j.data).slice(0, 100));
            }
        } catch(e) {}
    }
    process.exit(0);
}
queryRedis();
