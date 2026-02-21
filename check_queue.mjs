import { getCandidateIdByPhone, getWaitlist } from './api/utils/storage.js';

async function check() {
    try {
        let phone = '8116038195'; 
        let id = await getCandidateIdByPhone(phone);
        if(!id) return console.log('Candidate not found');
        
        let waitlist = await getWaitlist(id);
        console.log('Waitlist length:', waitlist.length);
        console.log('Waitlist contents:', JSON.stringify(waitlist, null, 2));

        const isLocked = await import('./api/utils/storage.js').then(m => m.isCandidateLocked(id));
        console.log('Is Locked:', isLocked);
    } catch(e) { console.error(e); }
    process.exit(0);
}
check();
