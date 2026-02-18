
const { getRedisClient, getCandidateById, getProjectById } = require('./api/utils/storage.js');

async function debug() {
    const client = getRedisClient();
    const phone = '5218116038195'; // Assuming this is the test phone based on previous sessions
    const candidateId = await client.hget('index:cond_phone', phone);

    if (!candidateId) {
        console.log("Candidate not found by phone");
        return;
    }

    const candidate = await getCandidateById(candidateId);
    console.log("Candidate State:", JSON.stringify({
        id: candidate.id,
        nombre: candidate.nombreReal,
        projectId: candidate.projectId,
        stepId: candidate.stepId
    }, null, 2));

    if (candidate.projectId) {
        const project = await getProjectById(candidate.projectId);
        console.log("Project Steps:", project.steps.map(s => ({
            id: s.id,
            name: s.name,
            prompt: s.aiConfig?.prompt?.substring(0, 50) + '...'
        })));

        const currentStep = project.steps.find(s => s.id === (candidate.stepId || 'step_new')) || project.steps[0];
        console.log("Current Step Prompt:", currentStep.aiConfig?.prompt);
    }

    process.exit(0);
}

debug();
