import { getRedisClient, getCandidateByPhone } from './api/utils/storage.js';

async function main() {
    const redis = getRedisClient();
    const phone = '8116038195';
    const cand = await getCandidateByPhone(phone);

    if (!cand) {
        console.log("Not found.");
        process.exit(1);
    }

    console.log("CANDIDATE ID:", cand.id);
    console.log("ADN:", JSON.stringify(cand, null, 2));

    const logs = await redis.lrange(`debug:agent:logs:${cand.id}`, 0, 5);
    console.log(`\n--- GPT TRACES (${logs.length}) ---`);
    logs.forEach(l => {
        const ll = JSON.parse(l);
        console.log(`\n[${ll.timestamp}] intent: ${ll.intent} -> Text: ${ll.receivedMessage}`);
        console.log(`  AI Result:`, JSON.stringify(ll.aiResult, null, 2));
    });

    console.log("\n--- REFINEMENT LOGS ---");
    const eLogs = await redis.lrange(`debug:extraction_logs`, 0, 10);
    eLogs.forEach(l => {
        const d = JSON.parse(l);
        if (d.candidateId === cand.id) {
            console.log(JSON.stringify(d, null, 2));
        }
    });

    process.exit(0);
}
main();
