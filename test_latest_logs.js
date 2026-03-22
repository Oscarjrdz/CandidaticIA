import { getRedisClient } from './api/utils/storage.js';
async function diag() {
    const redis = getRedisClient();
    const logs = await redis.lrange('telemetry_logs_v4', 0, 10);
    for(const l of logs) {
        try { console.log(l); } catch(e) {}
    }
    process.exit(0);
}
diag();
