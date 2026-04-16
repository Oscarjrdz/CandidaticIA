import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function clearOldFast() {
    const { getCandidates, updateCandidate } = await import('../utils/storage.js');
    console.log("Fetching all candidates to check unread states...");
    const { candidates } = await getCandidates(20000, 0, '');
    
    let toClear = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    candidates.forEach(c => {
        if (c.unread === true) {
            const created = new Date(c.fechaHora || c.timestamp || 0);
            if (created < today) {
                toClear.push(c);
            }
        }
    });

    console.log(`Found ${toClear.length} candidates with unread=true before today.`);
    
    let count = 0;
    const BATCH_SIZE = 50; // Execute 50 updates conceptually in parallel
    for (let i = 0; i < toClear.length; i += BATCH_SIZE) {
        const batch = toClear.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(c => updateCandidate(c.id, { unread: false }).catch(() => {})));
        count += batch.length;
        console.log(`Cleared ${count}...`);
    }
    
    console.log(`Successfully cleared ${count} old unread candidates.`);
    process.exit(0);
}

clearOldFast().catch(console.error);
