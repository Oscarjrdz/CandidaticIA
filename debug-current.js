
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
            const data = await client.get(`candidate:${candidateId}`);
            console.log(`CANDIDATE DATA:`, data);

            const projectLink = await client.hget('index:cand_project', candidateId);
            console.log(`PROJECT LINK: ${projectLink}`);

            // Check if there are ANY debug logs or telemetry for this ID
            const logs = await client.lrange(`debug:agent:logs:${candidateId}`, 0, 10);
            console.log(`DEBUG LOGS: ${logs.length}`);
            logs.forEach((l, i) => {
                const p = JSON.parse(l);
                console.log(`\n--- LOG ${i} ---`);
                console.log(`Step: ${p.stepId}`);
                console.log(`User: ${p.receivedMessage}`);
                console.log(`Response: ${p.aiResult?.response_text}`);
                console.log(`Thought: ${p.aiResult?.thought_process}`);
            });
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};
test();
