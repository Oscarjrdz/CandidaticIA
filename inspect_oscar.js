import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function inspectOscar() {
    const candidateId = "cand_1770703095496_5lld9pmtj";
    try {
        console.log(`Inspecting candidate: ${candidateId}`);
        const data = await redis.get(`candidate:${candidateId}`);
        console.log("--- Candidate Data ---");
        console.log(JSON.stringify(JSON.parse(data), null, 2));

        console.log("\n--- Recent Logs ---");
        const logs = await redis.lrange(`debug:agent:logs:${candidateId}`, 0, 10);
        logs.forEach((log, i) => {
            const l = JSON.parse(log);
            console.log(`[${i}] ${l.timestamp} | Intent: ${l.intent} | AI Used: ${l.apiUsed}`);
            console.log(`   Message: "${l.receivedMessage}"`);
            console.log(`   AI Result Thought: ${l.aiResult?.thought_process}`);
            console.log(`   AI Response: "${l.aiResult?.response_text}"`);
        });

        console.log("\n--- Message History ---");
        // Check message history key if it exists
        // Based on storage.js: getMessages uses a key
        // Let's check keys like 'messages:candidateId'
        const msgKeys = await redis.keys(`*${candidateId}*`);
        console.log("Potential message keys:", msgKeys);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

inspectOscar();
