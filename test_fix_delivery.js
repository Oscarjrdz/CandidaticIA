
import { processMessage } from './api/ai/agent.js';
import { getCandidateById } from './api/utils/storage.js';

async function run() {
    const candidateId = 'cand_1772032125322_yknf1wars';
    const message = {
        id: 'test_msg_id',
        content: 'Secundaria',
        from: '5218116038195'
    };

    console.log('🚀 Final Verification of Delivery Flow...');

    // Mocking UltraMsg environment
    process.env.ULTRAMSG_INSTANCE_ID = 'test';
    process.env.ULTRAMSG_TOKEN = 'test';
    process.env.REDIS_URL = 'redis://default:AejdAEEAAiBtNWFlM2I2ZTRmYTU0NmQ2YTRiYzdkZTllYmI5MWU4ZnAxMA@fair-ladybug-43171.upstash.io:6379';

    try {
        const response = await processMessage(candidateId, message, 'test_msg_id');
        console.log('✅ AGENT FINAL RESPONSE (Vacancy Info should be here):', response);
    } catch (err) {
        console.error('❌ FATAL ERROR:', err);
    }
    process.exit(0);
}

run();
