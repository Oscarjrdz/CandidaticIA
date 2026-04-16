import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function clearOld() {
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
    for (const c of toClear) {
        try {
            await updateCandidate(c.id, { unread: false });
            count++;
            if (count % 10 === 0) console.log(`Cleared ${count}...`);
        } catch (e) {
            console.error(`Failed to clear ${c.id}: ${e.message}`);
        }
    }
    
    console.log(`Successfully cleared ${count} old unread candidates.`);
    process.exit(0);
}

clearOld().catch(console.error);
