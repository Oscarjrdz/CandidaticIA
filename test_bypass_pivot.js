import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getActiveBypassRules, getProjects } from './api/utils/storage.js';

// Mock Candidate that matches both GRAFTECH and AISIN
// Graftech bypass limits: Homnre, 18-50, Primaria/Sec/Prep, Apodaca, Ayudante General
// Aisin bypass limits: Cualquiera, 18-55, Prim/Sec/Prep/Tec, Apodaca, Ayudante General
const mockCandidate = {
    id: 'sim_pivot_test',
    whatsapp: '1234567890',
    nombreReal: 'Juan Perez',
    fechaNacimiento: '01/01/1990', // 36 years old -> matches both
    municipio: 'Apodaca',          // Matches both
    escolaridad: 'Secundaria',     // Matches both
    genero: 'Hombre',              // Matches both
    categoria: 'Ayudante General', // Matches both
    proyecto: 1, // Currently on a project
    historialRechazos: [
        { vacancyId: 'vac_random_graftech', projectId: 'proj_1775062992690_xp8g45', razon: 'No quiso Graftech' }
    ]
};

async function testMatch() {
    const rules = await getActiveBypassRules();
    const allProjects = await getProjects();
    
    // We basically do what Orchestrator / candidate rejection does:
    // Finds the best passing rule, excluding the currently rejected project.
    
    // Let's pretend candidate just rejected Graftech
    const excludedProjectId = 'proj_1775062992690_xp8g45'; 

    for (const rule of rules) {
        if (rule.projectId === excludedProjectId) continue; // Exclude rejected project
        
        let pass = true;
        // Check age
        if (rule.minAge || rule.maxAge) {
            const ageMins = Number(rule.minAge) || 0;
            const ageMaxs = Number(rule.maxAge) || 99;
            const yMatch = mockCandidate.fechaNacimiento.match(/\b(19|20)\d{2}\b/);
            if (yMatch) {
               const age = new Date().getFullYear() - parseInt(yMatch[0]);
               if (age < ageMins || age > ageMaxs) pass = false;
            }
        }
        
        // Check municipality
        if (pass && rule.municipios && rule.municipios.length > 0) {
           const cMun = (mockCandidate.municipio||'').toLowerCase();
           if (!rule.municipios.some(m => m.toLowerCase() === cMun)) pass = false;
        }

        // Check gender
        if (pass && rule.gender && rule.gender !== 'Cualquiera') {
           if ((mockCandidate.genero||'').toLowerCase() !== rule.gender.toLowerCase()) pass = false;
        }

        if (pass) {
           console.log(`✅ MATCHED RULE: ${rule.name} (Project: ${rule.projectId})`);
        } else {
           console.log(`❌ FAILED RULE: ${rule.name}`);
        }
    }
    process.exit(0);
}

testMatch();
