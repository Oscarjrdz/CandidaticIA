import dotenv from 'dotenv';
import { processRecruiterMessage } from './api/ai/recruiter-agent.js';

dotenv.config({ path: '.env.local' });
if (!process.env.OPENAI_API_KEY) {
    dotenv.config();
}

async function runTests() {
    const config = {
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiModel: 'gpt-4o-mini'
    };

    const project = {
        name: 'Proyecto Prueba',
        vacancyId: 'mock-vacancy',
        steps: [
            {
                id: 'step-cita',
                name: 'Cita',
                aiConfig: {
                    prompt: 'OBLIGATORIO: Ofrece al candidato opciones de DÍAS para su entrevista basándote en la disponibilidad de la vacante. Si ya eligió día, ofrécele HORARIOS. NUNCA ofrezcas horarios si no ha elegido día. Si hace una pregunta, respóndela amablemente pero siempre RE-PREGUNTA por los días o los horarios según dónde se haya quedado.'
                }
            }
        ]
    };

    const currentStep = project.steps[0];

    const mockVacancyContext = `
[DATOS REALES DE LA VACANTE]:
- Puesto: Operador de Producción
- Sueldo: $2,500 semanales
- Ubicación: Portal de las Flores 1, General Zuazua
- Días disponibles para entrevista: Lunes 15 de Abril, Martes 16 de Abril
- Horarios disponibles: 09:00 AM, 11:00 AM, 03:00 PM
`;

    // ----------------------------------------------------
    // ESCENARIO 1: Ya mostró DÍAS y el candidato pregunta otra cosa
    // ----------------------------------------------------
    console.log("=========================================");
    console.log("ESCENARIO 1: Eligiendo DÍAS + Pregunta suelta");
    console.log("=========================================");
    let candidateData1 = {
        id: 'test-1',
        nombreReal: 'Juan Perez',
        whatsapp: '8116038195',
        citaFecha: null,
        citaHora: null
    };

    let history1 = [
        { role: 'assistant', content: '¡Excelente Juan! Tengo entrevistas disponibles para el Lunes 15 de Abril o el Martes 16 de Abril 📅. ¿Qué día prefieres? 😊' },
        { role: 'user', content: '¿Cuánto es el pago semanal?' }
    ];

    try {
        let result1 = await processRecruiterMessage(candidateData1, project, currentStep, history1, config, config.openaiApiKey, mockVacancyContext);
        console.log("➡ RESPUESTA DE BRENDA:\n" + result1.response_text);
        console.log("\nJSON GENERADO:", JSON.stringify(result1.extracted_data));
        console.log("THOUGHT_PROCESS:", result1.thought_process);
    } catch(e) { console.error(e); }

    // ----------------------------------------------------
    // ESCENARIO 2: Eligiendo HORAS tras dar el día y pregunta otra cosa
    // ----------------------------------------------------
    console.log("\n=========================================");
    console.log("ESCENARIO 2: Eligiendo HORAS + Pregunta suelta");
    console.log("=========================================");
    let candidateData2 = {
        id: 'test-2',
        nombreReal: 'Maria Garcia',
        whatsapp: '8116038195',
        citaFecha: '2026-04-15', // Ya eligió día
        citaHora: null
    };

    let history2 = [
        { role: 'assistant', content: '¡Perfecto Maria! Para el Lunes 15 de Abril tengo entrevista a las: 1️⃣ 09:00 AM ⏰ 2️⃣ 11:00 AM ⏰ 3️⃣ 03:00 PM ⏰. ¿Te parece bien alguno de esos horarios? 😊' },
        { role: 'user', content: '¿Tienen transporte o donde queda exactamente?' }
    ];

    try {
        let result2 = await processRecruiterMessage(candidateData2, project, currentStep, history2, config, config.openaiApiKey, mockVacancyContext);
        console.log("➡ RESPUESTA DE BRENDA:\n" + result2.response_text);
        console.log("\nJSON GENERADO:", JSON.stringify(result2.extracted_data));
        console.log("THOUGHT_PROCESS:", result2.thought_process);
    } catch(e) { console.error(e); }

}

runTests();
