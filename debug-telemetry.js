
import fs from 'fs';
import Redis from 'ioredis';

const test = async () => {
    try {
        const envContent = fs.readFileSync('.env.prod.local', 'utf8');
        const redisUrlMatch = envContent.match(/REDIS_URL="?([^"\n]+)/);
        if (!redisUrlMatch) {
            console.error("No REDIS_URL found");
            process.exit(1);
        }
        const redisUrl = redisUrlMatch[1];
        const client = new Redis(redisUrl, { tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined });

        const events = await client.lrange('telemetry:ai:events', 0, 15);
        console.log(`Found ${events.length} events:`);

        events.forEach((e, i) => {
            const data = JSON.parse(e);
            if (data.action === 'recruiter_inference') {
                console.log(`\n--- REC INF ${i} (${data.timestamp || 'no-ts'}) ---`);
                console.log(`Cand: ${data.candidateId}`);
                console.log(`Details:`, JSON.stringify(data.extra, null, 2));
            }
        });

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};
test();
