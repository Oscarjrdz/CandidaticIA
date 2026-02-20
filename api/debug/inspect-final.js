import { getProjectById, getCandidateById } from '../utils/storage.js';
import { processRecruiterMessage } from '../ai/recruiter-agent.js';

export default async function handler(req, res) {
    try {
        const cid = 'cand_1771620713159_q1rcr0ngk';
        const pid = 'proj_1771225156891_10ez5k';
        const cand = await getCandidateById(cid);
        const project = await getProjectById(pid);
        const currentStep = project.steps[0];

        const config = { instanceId: 'test', token: 'test' };
        const hist = [
            { role: 'user', parts: [{ text: 'Preparatoria' }] },
            { role: 'model', parts: [{ text: '¡Súper! 🌟 Ya tengo tu perfil 100% completo. 📝✅' }] }
        ];

        console.log('Invoking recruiter just like agent.js line 1118...');
        // Mock API Key or let it pull from redis
        const recruiterResult = await processRecruiterMessage(cand, project, currentStep, hist, config, null);

        res.status(200).json({ success: true, recruiterResult });
    } catch (e) {
        console.error('CRASH:', e.message);
        res.status(500).json({ success: false, error: e.stack });
    }
}
