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
    console.log('--- PURGING HISTORY AND SIMULATING SEQUENCE ---');
    const cId = 'cand_1770703095496_5lld9pmtj'; // Oscar

    // Purge everything
    const redis = new Redis(redisUrl);
    await redis.del(`messages:${cId}`);

    const dataStr = await redis.get(`candidate:${cId}`);
    if (dataStr) {
        let data = JSON.parse(dataStr);
        delete data.nombreReal;
        delete data.apellidos;
        data.esNuevo = "SI";
        data.paso1Status = "INCOMPLETO";
        await redis.set(`candidate:${cId}`, JSON.stringify(data));
        console.log("Cleared Name and History perfectly.");
    }
    await redis.quit();

    try {
        console.log("\n💬 User: 'Usted es hermosa'");
        let result = await processMessage(cId, 'Usted es hermosa', 'sim_id_10');
        console.log('🤖 Bot:', result);

        console.log("\n💬 User: 'Oscar'");
        result = await processMessage(cId, 'Oscar', 'sim_id_11');
        console.log('🤖 Bot:', result);

        console.log("\n💬 User: 'Rodriguez'");
        result = await processMessage(cId, 'Rodriguez', 'sim_id_12');
        console.log('🤖 Bot:', result);

    } catch (e) {
        console.error('CRASH in processMessage:', e);
    }

    process.exit(0);
}

run().catch(console.error);
