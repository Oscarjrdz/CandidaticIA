import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
    console.log('--- CHECKING LATEST SECONDS FROM ZSET ---');
    const redis = new Redis(redisUrl);

    // Get the top 5 most recently active candidates
    const recentIds = await redis.zrevrange('candidates:list', 0, 4);

    console.log(`Found ${recentIds.length} recent IDs.`);

    for (const cId of recentIds) {
        const dataStr = await redis.get(`candidate:${cId}`);
        if (!dataStr) continue;

        const c = JSON.parse(dataStr);
        console.log(`\nCANDIDATE: ${c.nombre} (${c.whatsapp}) - ID: ${c.id}`);
        console.log(`Last Message Time: ${c.ultimoMensaje}`);

        const isLocked = await redis.get(`lock:candidate:${c.id}`);
        console.log(`Is Locked: ${isLocked}`);

        const waitlist = await redis.lrange(`waitlist:candidate:${c.id}`, 0, -1);
        console.log(`Waitlist (${waitlist.length} pending):`, waitlist);

        const history = await redis.lrange(`messages:${c.id}`, -3, -1);
        console.log(`Recent History:`, history.map(h => {
            const m = JSON.parse(h);
            return `[${m.from}] ${m.content?.substring(0, 50)}`;
        }));
    }

    process.exit(0);
}

run().catch(console.error);
