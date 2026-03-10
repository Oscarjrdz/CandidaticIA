import * as dotenv from 'dotenv';
import fs from 'fs';
// Force .env.vercel.local
dotenv.config({ path: '.env.vercel.local' });
import { getCandidates, getMessages } from './api/utils/storage.js';

(async () => {
    try {
        const result = await getCandidates(5);
        const cands = result.candidates || result;
        const cand = cands[0]; // get the absolute most recent
        if (!cand) {
            console.log('Not found');
            process.exit(1);
        }
        const msgs = await getMessages(cand.id);
        console.log(`== LAST 15 MESSAGES (${cand.nombreReal || cand.id}) ==`);
        console.log(msgs.slice(-15).map(m => m.from + ': ' + m.content).join('\n'));
        console.log('== META ==');
        console.log(JSON.stringify(cand.projectMetadata, null, 2));
    } catch (e) {
        console.error("Script Error:", e);
    }
    process.exit(0);
})();
