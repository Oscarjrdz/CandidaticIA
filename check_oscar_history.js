import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
    const redis = new Redis(redisUrl);
    const oscarCid = 'cand_1770703095496_5lld9pmtj';

    console.log(`--- HISTORY FOR OSCAR (${oscarCid}) ---`);
    const history = await redis.lrange(`messages:${oscarCid}`, 0, 50);
    history.forEach((m, i) => {
        const msg = JSON.parse(m);
        console.log(`[${msg.timestamp}] ${msg.from}: ${msg.content || '[Media/Other]'}`);
    });

    process.exit(0);
}

run().catch(console.error);
