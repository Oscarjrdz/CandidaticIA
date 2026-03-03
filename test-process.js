import { processMessage } from './api/ai/agent.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    const candId = 'test_user_123';
    try {
        console.log("Calling processMessage...");
        const result = await processMessage(candId, 'Hola');
        console.log("Result:", result);
    } catch (e) {
        console.error("Error thrown:", e);
    }
    process.exit(0);
}

run();
