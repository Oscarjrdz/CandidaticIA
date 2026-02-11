import { processMessage } from './api/ai/agent.js';
import { getRedisClient } from './api/utils/storage.js';

async function diagnoseSilence() {
    const candidateId = 'cand_1770759817175_k50ag73nq'; // Oscar Rodriguez

    // We mock the incoming audio payload as it would come from the webhook
    const audioPayload = {
        type: 'audio',
        url: 'https://file-example.s3-accelerate.amazonaws.com/voice/oog_example.ogg'
    };

    console.log('🕵️‍♀️ Starting Brenda Silence Diagnosis...');
    console.log(`👤 Candidate: ${candidateId}`);

    try {
        console.log('🤖 Invoking AI Agent directly...');
        const response = await processMessage(candidateId, audioPayload);

        if (response) {
            console.log('✅ Brenda Responded:', response);
        } else {
            console.log('❌ BRENDA IS SILENT. (Returned null/empty)');
        }
    } catch (error) {
        console.error('💥 FATAL ERROR during processing:', error);
    }
}

diagnoseSilence();
