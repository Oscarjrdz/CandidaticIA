
import { getRedisClient, getProjects, getCandidateByPhone } from './api/utils/storage.js';

async function debug() {
    const redis = getRedisClient();
    try {
        console.log('--- SYSTEM CONFIG ---');
        const bE = await redis.get('bypass_enabled');
        const bS = await redis.get('bypass_selection');
        console.log('bypass_enabled:', bE);
        console.log('bypass_selection:', bS);

        const projects = await getProjects();
        console.log('Total Projects:', projects.length);
        projects.forEach(p => {
            console.log(`- Project: ${p.id} (${p.name}), Vacancies: ${p.vacancyIds?.length || 0}, Steps: ${p.steps?.length || 0}`);
        });

        console.log('\n--- CANDIDATE STATE (Last Run) ---');
        const lastRunRaw = await redis.get('debug:global:last_run');
        if (lastRunRaw) {
            const lastRun = JSON.parse(lastRunRaw);
            console.log('Last Candidate ID:', lastRun.candidateId);
            const cand = await redis.get('candidate:' + lastRun.candidateId);
            if (cand) {
                const c = JSON.parse(cand);
                console.log('Candidate Name:', c.nombreReal);
                console.log('Candidate congratulated:', c.congratulated);
                console.log('Candidate projectId:', c.projectId);
                console.log('Candidate statusAudit:', c.statusAudit);
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
debug();
