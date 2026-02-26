import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
    const redis = new Redis(redisUrl);

    console.log('--- FETCHING AI TELEMETRY ---');
    const events = await redis.lrange('telemetry:ai:events', 0, 20);
    events.forEach((e, i) => {
        console.log(`\n[EVENT ${i}]`);
        console.log(JSON.stringify(JSON.parse(e), null, 2));
    });

    console.log('\n--- FETCHING HANDOVER TRACES (OSCAR) ---');
    const oscarCid = 'cand_1770703095496_5lld9pmtj';
    const traces = await redis.lrange(`trace:handover:${oscarCid}`, 0, 10);
    console.log(traces);

    console.log('\n--- FETCHING DEBUG BYPASS TRACES ---');
    const bypassTraces = await redis.lrange('debug:bypass:traces', 0, 5);
    bypassTraces.forEach((t, i) => {
        console.log(`\n[BYPASS ${i}]`);
        console.log(JSON.stringify(JSON.parse(t), null, 2));
    });

    process.exit(0);
}

run().catch(console.error);
