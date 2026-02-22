
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

        const phone = '5218116038195';
        const candidateId = await client.hget('candidatic:phone_index', phone);
        console.log(`CANDIDATE ID: ${candidateId}`);

        if (candidateId) {
            const logs = await client.lrange(`debug:agent:logs:${candidateId}`, 0, 5);
            console.log(`Found ${logs.length} logs:`);
            logs.forEach((l, i) => {
                const data = JSON.parse(l);
                console.log(`\n--- LOG ${i} (${data.timestamp}) ---`);
                console.log(`Msg: ${data.receivedMessage}`);
                console.log(`Step: ${data.stepId}`);
                console.log(`AI Result:`, JSON.stringify(data.aiResult, null, 2));
            });
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};
test();
