import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
    console.log('--- CHECKING QUEUES AND LOCKS ---');
    const redis = new Redis(redisUrl);

    const cId = 'cand_1770703095496_5lld9pmtj'; // Oscar
    console.log(`\nCANDIDATE ID: ${cId}`);

    const isLocked = await redis.get(`lock:candidate:${cId}`);
    console.log(`Is Locked: ${isLocked}`);

    const waitlist = await redis.lrange(`waitlist:candidate:${cId}`, 0, -1);
    console.log(`Waitlist (${waitlist.length} pending):`, waitlist);

    const history = await redis.lrange(`messages:${cId}`, -5, -1);
    console.log(`Recent History:`, history.map(h => {
        const m = JSON.parse(h);
        return `[${m.from}] ${m.content?.substring(0, 50)}`;
    }));

    // Also check for any new candidates from today
    const keys = await redis.keys('candidate:*');
    let recentCandidates = [];

    // only get the first 50 to avoid hanging
    for (const key of keys.slice(0, 50)) {
        const data = await redis.get(key);
        if (data) {
            recentCandidates.push(JSON.parse(data));
        }
    }

    recentCandidates.sort((a, b) => new Date(b.ultimoMensaje || 0) - new Date(a.ultimoMensaje || 0));
    const latest = recentCandidates[0];
    if (latest && latest.id !== cId) {
        console.log(`\nLATEST ACTIVE CANDIDATE: ${latest.nombre} (${latest.whatsapp}) - ID: ${latest.id}`);
        console.log(`Last Message: ${latest.ultimoMensaje}`);

        const latestLocked = await redis.get(`lock:candidate:${latest.id}`);
        console.log(`Is Locked: ${latestLocked}`);

        const latestWaitlist = await redis.lrange(`waitlist:candidate:${latest.id}`, 0, -1);
        console.log(`Waitlist (${latestWaitlist.length} pending):`, latestWaitlist);

        const lastMsgs = await redis.lrange(`messages:${latest.id}`, -2, -1);
        console.log(`Recent History:`, lastMsgs.map(h => {
            const m = JSON.parse(h);
            return `[${m.from}] ${m.content?.substring(0, 50)}`;
        }));
    }

    process.exit(0);
}

run().catch(console.error);
