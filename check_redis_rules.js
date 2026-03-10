import Redis from 'ioredis';
const redis = new Redis("redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341");
async function run() {
    try {
        const ids = await redis.zrevrange('candidates:list', 0, 50);
        if (!ids || ids.length === 0) return;

        const pipeline = redis.pipeline();
        ids.forEach(id => pipeline.get(`candidate:${id}`));
        const results = await pipeline.exec();

        const candidates = results
            .map(([err, res]) => {
                if (err || !res) return null;
                try { return JSON.parse(res); } catch { return null; }
            })
            .filter(i => i !== null && i.nombreReal && i.nombreReal.toLowerCase().includes('oscar'));

        console.log("=== Candidates Found ===");
        candidates.forEach(c => {
            console.log(`\nCandidate: ${c.nombreReal} (${c.whatsapp})`);
            console.log(`- escolaridad:`, c.escolaridad, `(type: ${typeof c.escolaridad}, isNull: ${c.escolaridad === null})`);
        });
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
