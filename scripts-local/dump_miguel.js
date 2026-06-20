import { getCandidates } from '../utils/storage.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function dump() {
    const { candidates } = await getCandidates(20000, 0, '');
    let matched = [];
    
    candidates.forEach(c => {
        if (
            (c.nombreReal && c.nombreReal.toLowerCase().includes('miguel') && c.nombreReal.toLowerCase().includes('angel')) ||
            (c.nombre && c.nombre.toLowerCase().includes('miguel') && c.nombre.toLowerCase().includes('angel'))
        ) {
            matched.push(c);
        }
    });

    console.log(`Matched ${matched.length} candidates`);
    matched.forEach(c => {
        console.log("-------------------");
        console.log("ID:", c.id);
        console.log("Nombre Real:", c.nombreReal);
        console.log("Nombre:", c.nombre);
        console.log("Tags:", JSON.stringify(c.tags));
        console.log("Tags Length:", c.tags?.length);
        console.log("Current Vacancy ID:", JSON.stringify(c.currentVacancyId), typeof c.currentVacancyId);
        console.log("Has any project?", !!c.currentVacancyId);
        console.log("Current Vacancy Name:", c.currentVacancyName);
        console.log("Manual Project ID:", c.manualProjectId);
    });

    process.exit(0);
}

dump().catch(console.error);
