import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const redis = getRedisClient();
    try {
        console.log("--- FETCHING AI TELEMETRY LOGS ---");
        const logsRaw = await redis.lrange('telemetry:ai_logs', 0, 10);
        const logs = logsRaw.map(l => JSON.parse(l));

        for (const log of logs) {
            console.log(`[${log.timestamp}] Action: ${log.action} | Success: ${log.success} | Cand: ${log.candidateId} | Error: ${log.error}`);
        }

    } catch (e) {
        console.error("Error fetching logs:", e);
    }
    process.exit(0);
}
run();
