import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function inspectX() {
    const candidateId = "cand_1772036194177_thr89clam";
    try {
        console.log(`Inspecting candidate: ${candidateId}`);
        const data = await redis.get(`candidate:${candidateId}`);
        const candidate = JSON.parse(data);
        console.log("--- Candidate Data ---");
        console.log(JSON.stringify(candidate, null, 2));

        console.log("\n--- Recent Debug Logs ---");
        const logs = await redis.lrange(`debug:agent:logs:${candidateId}`, 0, 10);
        logs.forEach((log, i) => {
            const l = JSON.parse(log);
            console.log(`[${i}] ${l.timestamp} | Intent: ${l.intent} | AI Used: ${l.apiUsed}`);
            console.log(`   Message: "${l.receivedMessage}"`);
            console.log(`   AI Result Thought: ${l.aiResult?.thought_process}`);
            console.log(`   AI Response: "${l.aiResult?.response_text}"`);
            console.log(`   Extracted Data: ${JSON.stringify(l.aiResult?.extracted_data)}`);
        });

        console.log("\n--- Message History (messages key) ---");
        const msgKey = `messages:${candidateId}`;
        const messages = await redis.lrange(msgKey, 0, 20);
        messages.forEach((m, i) => {
            const msg = JSON.parse(m);
            console.log(`[${i}] ${msg.from}: "${msg.content}"`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

inspectX();
