import { processMessage } from './api/ai/agent.js';
import { saveMessage } from './api/utils/storage.js';
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

async function simulateTurn(cId, userText, eventId) {
    console.log(`\n💬 User: '${userText}'`);
    await saveMessage(cId, {
        id: `sim_msg_${Date.now()}`,
        from: 'user',
        to: '5218116038195',
        type: 'chat',
        content: userText,
        timestamp: new Date().toISOString(),
        status: 'received'
    });
    let result = await processMessage(cId, userText, eventId);
    console.log('🤖 Bot:', result);
    return result;
}

async function run() {
    console.log('--- PURGING HISTORY AND SIMULATING GREETING LOOP (REALISTIC) ---');
    const cId = 'cand_1772145153642_p7kh83lwy'; // X
    const redis = new Redis(redisUrl);

    // Purge everything
    await redis.del(`messages:${cId}`);
    const dataStr = await redis.get(`candidate:${cId}`);
    if (dataStr) {
        let data = JSON.parse(dataStr);
        delete data.nombreReal;
        delete data.apellidos;
        data.esNuevo = "SI";
        data.paso1Status = "INCOMPLETO";
        await redis.set(`candidate:${cId}`, JSON.stringify(data));
        console.log("Cleared Name and History perfectly. esNuevo = SI");
    }
    await redis.quit();

    try {
        await simulateTurn(cId, 'Hola', 'sim_loop_1');
        await simulateTurn(cId, 'Hola licenciada como esta??', 'sim_loop_2');
        await simulateTurn(cId, 'Me llamo oscar', 'sim_loop_3');
    } catch (e) {
        console.error('CRASH in processMessage:', e);
    }

    process.exit(0);
}

run().catch(console.error);
