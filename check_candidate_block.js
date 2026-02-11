
import { getCandidateIdByPhone, getCandidateById } from './api/utils/storage.js';

async function checkCandidate() {
    const phones = ['5218131061487', '528131061487', '8131061487'];

    for (const phone of phones) {
        const id = await getCandidateIdByPhone(phone);
        if (id) {
            const candidate = await getCandidateById(id);
            console.log(`✅ Found Candidate [${phone}]: id=${id}, blocked=${candidate.blocked}`);
            return;
        }
    }
    console.log('❌ Candidate not found in Redis for any format');
}

checkCandidate();
