import { getCandidateById, getProjectById } from './api/utils/storage.js';
import { getRedisClient } from './api/utils/storage.js';

async function dumpCand() {
    const cand = await getCandidateById('cand_1774227947679_7g0jkyiuu');
    console.log(JSON.stringify(cand, null, 2));
    if (cand.activeProjectId) {
        const proj = await getProjectById(cand.activeProjectId);
        console.log("\n--- PROJECT ---");
        const step = proj.steps.find(s => s.id === cand.projectStates[cand.activeProjectId].currentStep);
        console.log(JSON.stringify(step, null, 2));
    }
    const redis = getRedisClient();
    const locks = await redis.get('lock:cand_1774227947679_7g0jkyiuu');
    console.log("\nLOCK:", locks);
    process.exit(0);
}
dumpCand();
