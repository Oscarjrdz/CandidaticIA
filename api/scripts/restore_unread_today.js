import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function restoreToday() {
    const { getCandidates, updateCandidate } = await import('../utils/storage.js');
    console.log("Fetching all candidates to check today's updates...");
    const { candidates } = await getCandidates(20000, 0, '');
    
    let toRestore = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    candidates.forEach(c => {
        // Use the correct date fields!
        const createdDate = new Date(c.primerContacto || c.creadoEn || 0);
        const lastMsgDate = new Date(c.ultimoMensaje || 0);
        
        // If created today or active today
        if (createdDate >= today || lastMsgDate >= today) {
            toRestore.push(c);
        }
    });

    console.log(`Found ${toRestore.length} candidates from today.`);
    
    let count = 0;
    const BATCH_SIZE = 50; 
    for (let i = 0; i < toRestore.length; i += BATCH_SIZE) {
        const batch = toRestore.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(c => updateCandidate(c.id, { unread: true }).catch(() => {})));
        count += batch.length;
        console.log(`Restored ${count}...`);
    }
    
    console.log(`Successfully restored ${count} unread candidates from today.`);
    process.exit(0);
}

restoreToday().catch(console.error);
