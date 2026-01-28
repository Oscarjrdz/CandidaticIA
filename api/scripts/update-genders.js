/**
 * Script to detect and update gender for existing candidates
 * Run via: node api/scripts/update-genders.js
 */

import { getCandidates, updateCandidate } from '../utils/storage.js';
import { detectGender } from '../utils/ai.js';

async function run() {

    try {
        const { candidates } = await getCandidates(5000, 0);

        let updated = 0;
        let skipped = 0;

        for (const candidate of candidates) {
            if (candidate.genero && candidate.genero !== 'Desconocido') {
                skipped++;
                continue;
            }

            const nameToUse = candidate.nombreReal || candidate.nombre;
            if (!nameToUse || nameToUse === 'Sin nombre') {
                skipped++;
                continue;
            }

            const gender = await detectGender(nameToUse);

            if (gender !== 'Desconocido') {
                await updateCandidate(candidate.id, { genero: gender });
                updated++;
            } else {
            }

            // Small delay to avoid rate limits if many candidates
            await new Promise(r => setTimeout(r, 200));
        }

        process.exit(0);

    } catch (error) {
        console.error('❌ Script error:', error);
        process.exit(1);
    }
}

run();
