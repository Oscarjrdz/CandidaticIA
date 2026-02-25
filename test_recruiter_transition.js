
import { processRecruiterMessage } from './api/ai/recruiter-agent.js';
import { getProjectById, getCandidateById, getRedisClient } from './api/utils/storage.js';

async function run() {
    const candidateId = 'cand_1772032125322_yknf1wars';
    const projectId = 'proj_1771225156891_10ez5k';
    const stepId = 'step_default';
    const congratsMsg = "¡Súper! 🌟 Ya tengo tu perfil 100% completo. 📝✅";

    console.log('🚀 Simulating recruiter transition for:', candidateId);

    const candidate = await getCandidateById(candidateId);
    if (!candidate) {
        console.error('❌ Candidate not found in Redis:', candidateId);
        process.exit(1);
    }
    const project = await getProjectById(projectId);
    if (!project) {
        console.error('❌ Project not found in Redis:', projectId);
        process.exit(1);
    }
    const step = project.steps.find(s => s.id === stepId) || project.steps[0];

    const history = [
        { role: 'user', parts: [{ text: 'No tengo trabajo actualmente' }] },
        { role: 'model', parts: [{ text: congratsMsg }] }
    ];

    const config = { instanceId: 'test', token: 'test' };
    const apiKey = process.env.OPENAI_API_KEY;

    console.log('🧠 Running processRecruiterMessage...');
    const result = await processRecruiterMessage(candidate, project, step, history, config, apiKey);

    console.log('✅ RESULT:', JSON.stringify(result, null, 2));
    process.exit(0);
}

run().catch(err => {
    console.error('❌ ERROR:', err);
    process.exit(1);
});
