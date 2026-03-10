import fs from 'fs';
import Redis from 'ioredis';

const envStr = fs.readFileSync('/tmp/.env.production', 'utf8');
const envMap = {};
envStr.split('\n').forEach(line => {
    const p = line.split('=');
    if (p.length > 1) envMap[p[0].trim()] = p.slice(1).join('=').trim().replace(/"/g, '');
});
const redis = new Redis(envMap['REDIS_URL']);

async function run() {
    const logs = await redis.lrange('telemetry:ai_logs', 0, 5);
    logs.forEach((log, index) => {
        const l = JSON.parse(log);
        console.log(`\n--- LOG [${index}] ---`);
        console.log('Timestamp:', l.timestamp);
        console.log('Action:', l.action);
        console.log('CandidateId:', l.candidateId);
        if (l.extra && l.extra.model) console.log('Model:', l.extra.model);
        if (l.error) console.log('Error:', l.error);
    });

    // Check if the AI wrote debug logs somewhere...
    // Actually, I can just grab the exact response string the AI generated from messages!
    const msg = await redis.lrange('messages:cand_1772943628116_3pmubhveo', -2, -1);
    console.log("\n--- LAST 2 MESSAGES ---");
    msg.forEach(m => console.log(JSON.parse(m)));
    await redis.quit();
}
run().catch(console.error);
