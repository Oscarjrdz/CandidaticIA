import Redis from 'ioredis';
const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
    const redis = new Redis(redisUrl);
    const id = await redis.hget('candidatic:phone_index', '5218116038195');
    console.log("Candidate ID for 5218116038195:", id);
    if (id) {
        const data = await redis.get(`candidate:${id}`);
        console.log("esNuevo:", JSON.parse(data).esNuevo);
    }
    process.exit(0);
}
run();
