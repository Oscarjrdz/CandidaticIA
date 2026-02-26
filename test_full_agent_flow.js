
import { processMessage } from './api/ai/agent.js';
import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const candidateId = 'cand_1769466470882_ckd3yvpq5';
    const message = {
        id: 'test_msg_id',
        content: 'No tengo trabajo actualmente',
        from: '5218116038195'
    };

    console.log('🚀 Simulating FULL AGENT FLOW for:', candidateId);

    // Mocking UltraMsg environment
    process.env.ULTRAMSG_INSTANCE_ID = 'test';
    process.env.ULTRAMSG_TOKEN = 'test';

    try {
        const response = await processMessage(candidateId, message);
        console.log('✅ AGENT FINAL RESPONSE:', response);
    } catch (err) {
        console.error('❌ FATAL ERROR:', err);
    }
    process.exit(0);
}

run();
