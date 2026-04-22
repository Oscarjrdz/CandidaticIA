import 'dotenv/config';
import { getCandidates, getRecentMessages } from './api/utils/storage.js';

async function checkEmpty() {
    try {
        console.log("Fetching all candidates...");
        const result = await getCandidates(10000, 0, '', true);
        const candidates = result.candidates || [];
        console.log(`Total candidates: ${candidates.length}`);

        let emptyByMessages = 0;
        let emptyByFields = 0;
        let emptyByStats = 0;
        let cWithMsgs = 0;

        for (const c of candidates) {
            const hasFields = !!(c.ultimoMensaje || c.lastUserMessageAt);
            const statsEmpty = !c.stats || c.stats.total === 0;

            if (!hasFields) emptyByFields++;
            if (statsEmpty) emptyByStats++;
            
            // To prevent hammering the DB, we'll only fetch actual messages for those who appear empty by fields/stats
            if (!hasFields || statsEmpty) {
                const messages = await getRecentMessages(c.id, 1);
                if (messages.length === 0) {
                    emptyByMessages++;
                }
            } else {
                cWithMsgs++;
            }
        }

        console.log(`Candidates missing ultimoMensaje AND lastUserMessageAt: ${emptyByFields}`);
        console.log(`Candidates with stats.total == 0: ${emptyByStats}`);
        console.log(`Candidates with exactly 0 messages in DB: ${emptyByMessages}`);
        console.log(`Candidates with >0 messages (inferred): ${cWithMsgs}`);

        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}
checkEmpty();
