
import { getRedisClient, getProjects, getCandidates } from './api/utils/storage.js';

async function list() {
    const projects = await getProjects();
    console.log('--- PROJECTS ---');
    projects.forEach(p => {
        console.log(`ID: ${p.id}, Name: ${p.name}`);
        p.steps.forEach(s => {
            console.log(`  Step: ${s.name} (id: ${s.id}) prompt: ${s.aiConfig?.prompt?.substring(0, 50)}...`);
        });
    });

    const candidates = await getCandidates(20);
    console.log('\n--- RECENT CANDIDATES ---');
    candidates.forEach(c => {
        console.log(`ID: ${c.id}, Name: ${c.nombreReal || c.nombre}, Phone: ${c.whatsapp}`);
    });

    process.exit(0);
}

list();
