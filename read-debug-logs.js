import { getRedisClient } from './api/utils/storage.js';

async function readLogs() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('❌ No Redis client');
        process.exit(1);
    }

    try {
        const logs = await redis.lrange('debug:extraction_log', 0, -1);
        console.log('--- EXTRACTION LOGS ---');
        logs.forEach((log, i) => {
            const entry = JSON.parse(log);
            console.log(`[${i}] ${entry.timestamp} - Candidate: ${entry.candidateId}`);
            console.log(`    Status: ${entry.status || 'OK'}`);
            console.log(`    Extracted: ${JSON.stringify(entry.extracted || entry.raw)}`);
            if (entry.refined) console.log(`    Refined: ${JSON.stringify(entry.refined)}`);
            console.log('---');
        });
        process.exit(0);
    } catch (err) {
        console.error('❌ Error reading logs:', err);
        process.exit(1);
    }
}

readLogs();
