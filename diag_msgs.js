import Redis from 'ioredis';
const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
    const redis = new Redis(redisUrl);
    const msgs = await redis.lrange('messages:cand_1772145153642_p7kh83lwy', 0, -1);
    console.log("Raw Messages in Redis:");
    msgs.forEach((m, i) => console.log(`[${i}]`, m));
    process.exit(0);
}
run();
