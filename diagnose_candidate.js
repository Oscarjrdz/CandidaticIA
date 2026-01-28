import { getCandidateByPhone, getMessages } from './api/utils/storage.js';

async function diagnose(phone) {
    console.log(`🔍 Searching for candidate: ${phone}...`);
    const candidate = await getCandidateByPhone(phone);

    if (!candidate) {
        console.log('❌ Candidate not found.');
        return;
    }

    console.log('\n--- CANDIDATE DATA ---');
    console.log(JSON.stringify(candidate, null, 2));

    console.log('\n--- CHAT HISTORY ---');
    const messages = await getMessages(candidate.id);
    messages.forEach(m => {
        const sender = (m.from === 'user' || m.from === 'me') ? 'Candidato' : 'Bot/Reclutador';
        console.log(`[${m.timestamp || '-'}] ${sender}: ${m.content || m.body || '(Sin contenido)'}`);
    });
}

diagnose('5218132520755');
