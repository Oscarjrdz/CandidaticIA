import { getCandidates } from '../utils/storage.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function inspect() {
    const { candidates } = await getCandidates(20000, 0, '');
    const c = candidates.find(can => can.nombreReal?.includes('Miguel Angel Yañez') || can.nombre?.includes('Miguel Angel Yañez'));
    
    if (c) {
        console.log("Candidate Data:");
        console.log({
            id: c.id,
            nombreReal: c.nombreReal,
            nombre: c.nombre,
            tags: c.tags,
            currentVacancyId: c.currentVacancyId,
            currentVacancyName: c.currentVacancyName,
            manualProjectId: c.manualProjectId
        });
    } else {
        console.log("Candidate not found.");
    }
    
    process.exit(0);
}

inspect().catch(console.error);
