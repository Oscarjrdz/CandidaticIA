import dotenv from 'dotenv';
dotenv.config();

import { getRedisClient } from './api/utils/storage.js';

async function test() {
    const redis = getRedisClient();
    if (!redis) {
        console.log('Redis still null');
        return;
    }
    const cands = await redis.smembers('candidates:list:all');
    for (const c of cands.slice(-2)) {
        const data = await redis.get('candidate:' + c);
        if (data) {
            const p = JSON.parse(data);
            console.log(`--- Candidate: ${p.nombreReal || p.nombre} ---`);
            console.log(`TieneEmpleo: ${p.tieneEmpleo}`);
            console.log(`Status: ${p.status}`);
            console.log(`Step ID: ${p.stepId}`);
        }
    }

    // Check if the automation log actually shows the engine firing
    try {
        const recentLogs = await redis.lrange('telemetry:ai_logs', 0, 10);
        console.log("Telemetry logs found:", recentLogs.length);
    } catch (e) { }

    process.exit(0);
}
test();
