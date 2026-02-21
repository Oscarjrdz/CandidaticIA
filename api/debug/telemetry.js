import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    try {
        const logsRaw = await redis.lrange('telemetry:ai_logs', 0, 20);
        const logs = logsRaw.map(l => JSON.parse(l));

        let out = "--- TELEMETRY LOGS ---\n";
        for (const log of logs) {
            out += `[${log.timestamp}] Action: ${log.action} | Success: ${log.success} | Cand: ${log.candidateId} | Error: ${log.error || 'None'}\n`;
        }
        res.status(200).send(out);
    } catch (e) {
        res.status(500).send(e.message);
    }
}
