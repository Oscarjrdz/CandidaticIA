import { processMessage } from './api/ai/agent.js';
import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

const originalLog = console.log;
console.log = function (...args) {
    if (String(args[0]).includes('[GPT CONSOLIDATED] ✅ Extraction')) {
        originalLog("[INTERCEPTED GPT RESULT]", JSON.stringify(args[1], null, 2));
    } else {
        originalLog(...args);
    }
};

async function run() {
    console.log('--- SIMULATING PROCESS MESSAGE FOR TEST CANDIDATE (X) ---');
    const cId = 'cand_1772142338460_1nkc19fic'; // X (5218116038195)

    // Reset Name to trigger extraction
    const redis = new Redis(redisUrl);
    const dataStr = await redis.get(`candidate:${cId}`);
    if (dataStr) {
        let data = JSON.parse(dataStr);
        delete data.nombreReal;
        delete data.apellidos;
        await redis.set(`candidate:${cId}`, JSON.stringify(data));
        console.log("Cleared Name to trigger extraction flow.");
    }
    await redis.quit();

    try {
        console.log("Simulating: 'Usted es hermosa'");
        const result = await processMessage(cId, 'Usted es hermosa', 'sim_id_TEST');
        console.log('\nFinal Result:', result);
    } catch (e) {
        console.error('CRASH in processMessage:', e);
    }

    process.exit(0);
}

run().catch(console.error);
