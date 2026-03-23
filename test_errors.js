import { getRedisClient } from './api/utils/storage.js';

async function query() {
    const redis = getRedisClient();
    const l = await redis.lrange('telemetry_logs_v4', -500, -1);
    for (const log of l) {
        try {
            const parsed = JSON.parse(log);
            if (parsed.type === 'AI_ERROR' || parsed.type.includes('ERROR') || parsed.data?.error) {
                console.log(parsed.timestamp, parsed.type, parsed.data?.candidateId || parsed.data?.from, parsed.data?.error);
            }
        } catch(e) {}
    }
    process.exit(0);
}
query();
