import { processMessage } from './api/ai/agent.js';
import { getCandidateIdByPhone, getRedisClient, unlockCandidate } from './api/utils/storage.js';

async function debug(phone, message) {
    console.log(`🔍 Debugging Brenda for phone: ${phone}`);

    const redis = getRedisClient();
    const isActive = await redis.get('bot_ia_active');
    console.log(`🤖 Bot Active Status (Redis): ${isActive}`);

    const candidateId = await getCandidateIdByPhone(phone);
    console.log(`👤 Candidate ID: ${candidateId}`);

    if (candidateId) {
        console.log(`🔓 Force unlocking candidate...`);
        await unlockCandidate(candidateId);
    }

    console.log(`🚀 Triggering processMessage...`);
    try {
        const response = await processMessage(candidateId, message);
        console.log(`✅ Brenda responded: "${response}"`);
    } catch (err) {
        console.error(`❌ Error in processMessage:`, err);
    }

    process.exit(0);
}

const phone = process.argv[2] || '5218116038195';
const msg = process.argv[3] || 'Hola, soy Oscar';

debug(phone, msg);
