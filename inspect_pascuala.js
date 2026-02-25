import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function inspectPascuala() {
    const candidateId = "cand_1772024236415_xj6rnfnc2";
    try {
        console.log(`Inspecting candidate: ${candidateId}`);
        const data = await redis.get(`candidate:${candidateId}`);
        const candidate = JSON.parse(data);
        console.log("--- Candidate Data ---");
        console.log(JSON.stringify(candidate, null, 2));

        console.log("\n--- Message History (Last 10) ---");
        const msgKey = `messages:${candidateId}`;
        const messages = await redis.lrange(msgKey, -10, -1);
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

inspectPascuala();
