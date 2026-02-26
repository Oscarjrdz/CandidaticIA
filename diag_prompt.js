import { processMessage } from './api/ai/agent.js';
import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

// Overwrite the original getOpenAIResponse to intercept prompts
import * as openaiModule from './api/utils/openai.js';
const originalGetResponse = openaiModule.getOpenAIResponse;
openaiModule.getOpenAIResponse = async function (messages, systemPrompt, model, key, format) {
    if (messages.length > 0 && messages[messages.length - 1].content === 'Hola licenciada como esta??') {
        console.log("\n--- [INTERCEPTED SYSTEM PROMPT FOR MSG 2] ---");
        console.log(systemPrompt);
        console.log("---------------------------------------------\n");
    }
    return originalGetResponse(messages, systemPrompt, model, key, format);
};

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
    await processMessage(cId, 'Hola', 'sim_diag_1');

    // Msg 2
    await processMessage(cId, 'Hola licenciada como esta??', 'sim_diag_2');

    await redis.quit();
    process.exit(0);
}

run().catch(console.error);
