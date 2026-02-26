
import {
    getRedisClient,
    getProjects,
    getCandidateById,
    auditProfile,
    getProjectById
} from './api/utils/storage.js';
import { Orchestrator } from './api/utils/orchestrator.js';

async function diagnose() {
    const redis = getRedisClient();
    try {
        console.log('--- SYSTEM STATUS ---');
        const bE = await redis.get('bypass_enabled');
        const bS = await redis.get('bypass_selection');
        console.log('bypass_enabled:', bE);
        console.log('bypass_selection:', bS);

        const projects = await getProjects();
        console.log('Active Projects:', projects.length);

        console.log('\n--- LAST CANDIDATE CHECK ---');
        const lastRunRaw = await redis.get('debug:global:last_run');
        if (lastRunRaw) {
            const { candidateId } = JSON.parse(lastRunRaw);
            const cand = await getCandidateById(candidateId);
            if (cand) {
                const audit = auditProfile(cand);
                console.log(`Candidate: ${cand.nombreReal} (${candidateId})`);
                console.log('Paso1 Status:', audit.paso1Status);
                console.log('Missing Fields:', audit.missingLabels);
                console.log('Congratulated:', cand.congratulated);
                console.log('ProjectId:', cand.projectId);

                const bypassEnabled = bE === 'true';
                const canBypass = await Orchestrator.checkBypass(cand, audit, bypassEnabled);
                console.log('>> Can Bypass Result:', canBypass);

                if (!canBypass) {
                    console.log('Why False?');
                    if (!bypassEnabled) console.log('- bypass_enabled is NOT true');
                    if (audit.paso1Status !== 'COMPLETO') console.log('- Profile is NOT complete');
                    if (cand.congratulated) console.log('- Candidate was ALREADY congratulated');
                    if (cand.projectId) console.log('- Candidate is ALREADY in a project');
                } else {
                    console.log('\n--- SIMULATING HANDOVER ---');
                    const bypassProjId = bS || (projects.length > 0 ? projects[0].id : null);
                    if (bypassProjId) {
                        const proj = await getProjectById(bypassProjId);
                        console.log(`Target Project: ${proj?.name || 'Unknown'}`);
                        if (!proj) console.log('ERROR: Project not found');
                        else if (!proj.steps?.length) console.log('ERROR: Project has no steps');
                        else console.log('Handover would likely succeed.');
                    } else {
                        console.log('ERROR: No bypass project available even though checkBypass is true.');
                    }
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
diagnose();
