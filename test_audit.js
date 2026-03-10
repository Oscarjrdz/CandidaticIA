import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { auditProfile, getCandidates } from './api/utils/storage.js';

(async () => {
    try {
        const cResponse = await getCandidates();
        const list = cResponse.candidates || cResponse;
        let cand = list.find(x => x.id === 'cand_1773154942716_gfc6mkqzp');

        if (!cand) {
            console.log("Candidate not found by ID. Trying fuzzy match...");
            cand = list.find(x => x.nombreReal && x.nombreReal.toLowerCase().includes('oscar rodriguez'));
        }

        if (cand) {
            console.log("Evaluating candidate:", cand.nombreReal, "Escolaridad db:", cand.escolaridad);
            const audit = auditProfile(cand);
            console.log("Audit Result:", audit);
        } else {
            console.log("Cand not found");
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
