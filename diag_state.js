import { processMessage } from './api/ai/agent.js';
import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
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
        console.log("Cleared state. esNuevo = SI");
    }

    // Msg 1
    await processMessage(cId, 'Hola', 'sim_loop_1');
    const state1 = await redis.get(`candidate:${cId}`);
    console.log("After Msg 1 esNuevo:", JSON.parse(state1).esNuevo);

    // Msg 2
    await processMessage(cId, 'Hola licenciada como esta??', 'sim_loop_2');
    const state2 = await redis.get(`candidate:${cId}`);
    console.log("After Msg 2 esNuevo:", JSON.parse(state2).esNuevo);

    await redis.quit();
    process.exit(0);
}

run().catch(console.error);
