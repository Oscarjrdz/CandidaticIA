import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function restore() {
    const { getCandidates, updateCandidate } = await import('../utils/storage.js');
    console.log("Fetching all candidates to RESTORE unread states...");
    const { candidates } = await getCandidates(20000, 0, '');
    
    let toRestore = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    candidates.forEach(c => {
        const lastMsgTime = new Date(c.lastUserMessageAt || c.ultimoMensaje || 0);
        // FORCE ANY CANDIDATE WITH MESSAGES TODAY THAT ARE NOT READ
        if (lastMsgTime >= today) {
            toRestore.push(c);
        }
    });

    console.log(`Found ${toRestore.length} candidates with activity TODAY to mark unread.`);
    
    let count = 0;
    for (const c of toRestore) {
        try {
            await updateCandidate(c.id, { unread: true });
            count++;
        } catch (e) {
            console.error(`Error restoring ${c.id}`);
        }
    }
    console.log(`Successfully restored ${count} candidates.`);
}

restore().then(() => process.exit(0));
