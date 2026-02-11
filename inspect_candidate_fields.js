
import { getCandidates } from './api/utils/storage.js';

async function inspect() {
    const { candidates } = await getCandidates(1);
    if (candidates && candidates.length > 0) {
        console.log('Candidate Sample:', JSON.stringify(candidates[0], null, 2));
    } else {
        console.log('No candidates found.');
    }
    process.exit(0);
}

inspect();
