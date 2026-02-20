import { getProjectById, getCandidateById } from './api/utils/storage.js';
import { processRecruiterMessage } from './api/ai/recruiter-agent.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    const cid = 'cand_1771620713159_q1rcr0ngk';
    const pid = 'proj_1771225156891_10ez5k';
    const cand = await getCandidateById(cid);
    const project = await getProjectById(pid);
    const currentStep = project.steps[0];
    
    // minimal config
    const config = { instanceId: 'test', token: 'test' };
    
    const hist = [
        { role: 'user', parts: [{ text: 'Preparatoria' }] },
        { role: 'model', parts: [{ text: '¡Súper! 🌟 Ya tengo tu perfil 100% completo. 📝✅' }] }
    ];

    console.log('Invoking recruiter just like agent.js line 1118...');
    try {
        const res = await processRecruiterMessage(cand, project, currentStep, hist, config, process.env.OPENAI_API_KEY);
        console.log('SUCCESS:', res);
    } catch (e) {
        console.error('CRASH:', e);
    }
    process.exit(0);
}
run();
