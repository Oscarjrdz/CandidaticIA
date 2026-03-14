import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { getRedisClient, getVacancyById } from './api/utils/storage.js';
import { processRecruiterMessage } from './api/ai/recruiter-agent.js';

async function run() {
    console.log("Redis URL:", process.env.UPSTASH_REDIS_REST_URL ? "SET" : "UNSET");
    
    const candidateData = {
        id: 'test_123',
        nombreReal: 'TESTER',
        whatsapp: '8116038195',
        escolaridad: 'Preparatoria'
    };
    const project = {
        vacancyId: 'vac_1740082717015_eplz0' // The ID where he probably asked "transporte"
    };
    const currentStep = {
        name: 'Preguntas',
        objective: 'Responder dudas'
    };
    const recentHistory = [
        { role: 'model', content: '¿Qué información necesitas?' },
        { role: 'user', content: 'Qué rutas de transporte hay?' }
    ];

    try {
        const client = getRedisClient();
        const faqData = await client.get(`vacancy_faq:${project.vacancyId}`);
        console.log("=== FAQ FETCHED BEFORE PROMPT ===");
        console.log(faqData ? faqData.substring(0, 500) : "NO FAQ DATA");

        const result = await processRecruiterMessage(candidateData, project, currentStep, recentHistory, { instanceId: 'test', token: 'test' });
        
        console.log("\n=== RESULT FROM AGENT ===");
        console.log("response_text:", result.response_text);
        console.log("media_url:", result.media_url);
        console.log("unanswered_question:", result.unanswered_question);

    } catch (e) {
        console.error(e);
    }
    
    process.exit(0);
}

run();
