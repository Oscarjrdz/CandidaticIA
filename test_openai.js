import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { getRedisClient } from './api/utils/storage.js';
import { processRecruiterMessage } from './api/ai/recruiter-agent.js';

async function run() {
    const candidateData = {
        id: 'test_123',
        nombreReal: 'TESTER',
        whatsapp: '8116038195',
        escolaridad: 'Preparatoria'
    };
    const project = {
        vacancyId: 'vac_1740082717015_eplz0'
    };
    const currentStep = {
        name: 'Preguntas',
        objective: 'Responder dudas',
        instructions: 'Responde cortesmente'
    };
    // Let's ask exactly the question that failed
    const recentHistory = [
        { role: 'model', content: '¿Qué información necesitas?' },
        { role: 'user', content: 'Hay transporte?' },
        { role: 'model', content: 'Sí, hay transporte disponible para los empleados. Además, se ofrecen vales de despensa de $750 mensuales que aumentan a $830 en planta. 😊🚌✨\n\n¿Te gustaría agendar tu entrevista? 😊' },
        { role: 'user', content: 'Que rutas de transporte hay' }
    ];

    try {
        console.log("=== CALLING PROCESS_RECRUITER_MESSAGE ===");
        const result = await processRecruiterMessage(
            candidateData, 
            project, 
            currentStep, 
            recentHistory, 
            { instanceId: 'test', token: 'test' },
            process.env.OPENAI_API_KEY
        );
        
        console.log("\n=== AI RESULT ===");
        console.log(JSON.stringify(result, null, 2));

    } catch (e) {
        console.error("ERROR:", e);
    }
    
    process.exit(0);
}

run();
