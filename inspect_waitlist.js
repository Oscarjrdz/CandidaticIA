import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function inspectWaitlist() {
    const candidateId = "cand_1772036194177_thr89clam";
    try {
        const waitlist = await redis.lrange(`waitlist:candidate:${candidateId}`, 0, -1);
        console.log(`Waitlist for ${candidateId}:`, waitlist);

        const locked = await redis.get(`lock:candidate:${candidateId}`);
        console.log(`Lock status: ${locked ? 'LOCKED' : 'FREE'}`);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

inspectWaitlist();
