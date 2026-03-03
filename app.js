import { getRedisClient } from './api/utils/storage.js';

async function run() {
    process.env.REDIS_URL = 'redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341';
    const r = getRedisClient();
    try {
        const globalStr = await r.get('debug:global:last_run');
        console.log("Global str:", globalStr);
        if (globalStr) {
            const global = JSON.parse(globalStr);
            const candId = global.candidateId;
            console.log("Found recent run for candidate:", candId);
            const logs = await r.lrange(`debug:agent:logs:${candId}`, 0, 5);
            for (let i = 0; i < logs.length; i++) {
                const parsed = JSON.parse(logs[i]);
                console.log(`\n--- TRACE [${i}] ---`);
                console.log("receivedMessage:", parsed.receivedMessage);
                console.log("extracted_data:", JSON.stringify(parsed.aiResult?.extracted_data));
                console.log("response_text:", parsed.aiResult?.response_text);

            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();
