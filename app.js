import { getRedisClient } from './api/utils/storage.js';

async function run() {
    process.env.REDIS_URL = 'redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341';
    const r = getRedisClient();
    try {
        const globalStr = await r.get('debug:global:last_run');
        console.log("Global str:", globalStr);
        if (globalStr) {
            const global = JSON.parse(globalStr);
            console.log("Found recent run for candidate:", global.candidateId);
            const logs = await r.lrange(`debug:agent:logs:${global.candidateId}`, 0, 0);
            if (logs.length > 0) {
                console.log("LAST AI EXECUTION:");
                const parsed = JSON.parse(logs[0]);
                console.log(JSON.stringify(parsed, null, 2));
            } else {
                console.log("No logs found for candidate.");
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();
