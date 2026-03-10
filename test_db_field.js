import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getCandidates } from './api/utils/storage.js';

(async () => {
    try {
        const c = await getCandidates(20);
        const list = c.candidates || c;
        const cand = list.find(x => x.nombreReal && x.nombreReal.toLowerCase().includes('oscar rodriguez'));
        if (cand) {
            console.log("Candidate ID:", cand.id);
            console.log("Escolaridad:", cand.escolaridad);
            console.log("Meta escolaridad:", cand.projectMetadata?.escolaridad);
            console.log("Full Obj Keys:", Object.keys(cand));
            console.log("Full payload:", JSON.stringify(cand, null, 2));
        } else {
            console.log("Cand not found");
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
