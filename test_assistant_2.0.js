import { processMessage } from './api/ai/agent.js';

async function testIntent(label, message) {
    console.log(`\n--- TEST: ${label} ---`);
    console.log(`User: ${message}`);
    try {
        const response = await processMessage('5218116038195', message);
        console.log(`Brenda: ${response}`);
    } catch (e) {
        console.error(`Error:`, e);
    }
}

async function runTests() {
    // 1. Attention Trigger
    await testIntent('ATTENTION', 'Oye');

    // 2. Small Talk / Flirt
    await testIntent('SMALL_TALK', 'Estás muy guapa hoy');

    // 3. Closure
    await testIntent('CLOSURE', 'Gracias Brenda');

    // 4. Data Give (Context: should still work)
    await testIntent('DATA_GIVE', 'Vivo en Monterrey');
}

runTests();
