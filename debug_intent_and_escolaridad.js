import { classifyIntent } from './api/ai/intent-classifier.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    try {
        console.log("--- TEST INTENT CLASSIFIER ---");
        const msg = "Esta vacante no me interesa";
        console.log(`Classifying: "${msg}"`);
        const intent = await classifyIntent('test_1', msg, "Contexto previo: Te envié información de la vacante Prolec.");
        console.log(`Result: ${intent}`);
    } catch (e) {
        console.error("Intent error:", e);
    }
    process.exit(0);
}
run();
