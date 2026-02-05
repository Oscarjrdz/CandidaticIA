import { getRedisClient, getCandidateById, getMessages } from './api/utils/storage.js';

async function diagnose() {
    const phone = '5218116038195';
    const candidate = await getCandidateById(phone);
    const messages = await getMessages(phone, 20);

    console.log('--- CANDIDATE DATA ---');
    console.log(JSON.stringify(candidate, null, 2));
    console.log('\n--- CHAT HISTORY ---');
    messages.forEach(m => {
        console.log(`[${m.from}] ${m.content}`);
    });
}

diagnose().then(() => process.exit(0)).catch(console.error);
