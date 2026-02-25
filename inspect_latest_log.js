import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function inspectLatestLog() {
    const candidateId = "cand_1772036194177_thr89clam";
    try {
        const logs = await redis.lrange(`debug:agent:logs:${candidateId}`, 0, 0);
        if (logs.length > 0) {
            const l = JSON.parse(logs[0]);
            console.log(`Latest Log Trace:`);
            console.log(JSON.stringify(l, null, 2));
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

inspectLatestLog();
