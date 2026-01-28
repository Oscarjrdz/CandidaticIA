import { getCandidateByPhone, getMessages } from './api/utils/storage.js';

async function diagnose(phone) {
    const candidate = await getCandidateByPhone(phone);

    if (!candidate) {
        return;
    }


    const messages = await getMessages(candidate.id);
    messages.forEach(m => {
        const sender = (m.from === 'user' || m.from === 'me') ? 'Candidato' : 'Bot/Reclutador';
    });
}

diagnose('5218132520755');
