
import { getCandidateById, getProjectById, getMessages } from './api/utils/storage.js';

async function audit() {
    const candidateId = '5218116038195'; // Admin phone often used for testing
    const candidate = await getCandidateById(candidateId);
    console.log('CANDIDATE:', JSON.stringify(candidate, null, 2));

    if (candidate && candidate.projectId) {
        const project = await getProjectById(candidate.projectId);
        console.log('PROJECT STEPS:', project.steps.map(s => ({ id: s.id, name: s.name, prompt: s.aiConfig?.prompt })));
    }

    const messages = await getMessages(candidateId);
    console.log('HISTORY (Last 5):', messages ? messages.slice(-5) : 'No messages');

    process.exit(0);
}

audit();
