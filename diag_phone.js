import { getUsers, getCandidates } from './api/utils/storage.js';

async function diagnose() {
    try {
        const cands = await getCandidates();
        const cand = cands.find(c => c.whatsapp && c.whatsapp.includes('8116038195'));
        if (cand) {
            console.log(JSON.stringify(cand.projectMetadata, null, 2));
            console.log('ID:', cand.id);
        } else {
            console.log('Not found');
        }
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
diagnose();
