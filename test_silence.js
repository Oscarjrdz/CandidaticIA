import { processRecruiterMessage } from './api/ai/recruiter-agent.js';
import { getOpenAIResponse } from './api/utils/openai.js';

async function run() {
    try {
        const candidateData = {
            id: 'test-silence-1',
            nombreReal: 'Tests',
            whatsapp: '1234567890'
        };
        const project = {
            id: 'proj_1',
            name: 'Test Project',
            vacancyId: 'vac_test',
            steps: [{ id: 'step_new', name: 'Info', aiConfig: { enabled: true, prompt: "Objetivo: dar info" } }]
        };
        const currentStep = project.steps[0];
        const recentHistory = [{ role: 'user', content: 'Hay ruta de transporte para zuazua??' }];
        
        console.log("Running Recruiter Agent...");
        const result = await processRecruiterMessage(candidateData, project, currentStep, recentHistory, {}, process.env.OPENAI_API_KEY, 0);
        console.log("Result:", result);
    } catch(e) {
        console.error("Error:", e);
    }
}
run();
