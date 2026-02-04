
import { getRedisClient, getCandidateById, getMessages } from './api/utils/storage.js';
import { auditProfile } from './api/utils/storage.js';

async function diagnose() {
    const phone = '5218116038195';
    console.log('--- DIAGNOSIS FOR:', phone, '---');

    try {
        const redis = getRedisClient();
        const candidateId = await redis.get(`phone_to_id:${phone}`);
        if (!candidateId) {
            console.error('Candidate ID not found for phone:', phone);
            process.exit(1);
        }

        const candidate = await getCandidateById(candidateId);
        console.log('Candidate Data:', JSON.stringify(candidate, null, 2));

        const audit = auditProfile(candidate);
        console.log('Audit Result:', JSON.stringify(audit, null, 2));

        const messages = await getMessages(candidateId, 10);
        console.log('Recent Messages:', JSON.stringify(messages, null, 2));

        process.exit(0);
    } catch (e) {
        console.error('Diagnosis Error:', e);
        process.exit(1);
    }
}

diagnose();
