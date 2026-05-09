import { getOpenAIResponse } from './api/utils/openai.js';

const mockSnapshot = {
    timezone: 'America/Monterrey',
    totals: { candidates: 1050, completeAudited: 800, pendingAudited: 250 },
    newCandidates: {
        today: { date: '2026-05-09', count: 12 },
        yesterday: { date: '2026-05-08', count: 45 },
        averageLast7Days: 30,
        averageLast30Days: 25
    },
    distributions: {
        byEducation: [
            { label: 'Preparatoria', count: 400 },
            { label: 'Secundaria', count: 200 },
            { label: 'Universidad', count: 150 },
            { label: 'Sin escolaridad', count: 50 }
        ],
        byGender: [
            { label: 'Femenino', count: 550 },
            { label: 'Masculino', count: 250 }
        ]
    }
};

const compactStats = `
=== BASE DE CANDIDATOS (cifras reales, ${mockSnapshot.timezone}) ===
Total: ${mockSnapshot.totals.candidates} | Completos: ${mockSnapshot.totals.completeAudited} | Pendientes: ${mockSnapshot.totals.pendingAudited}
Hoy (${mockSnapshot.newCandidates.today.date}): ${mockSnapshot.newCandidates.today.count} | Ayer (${mockSnapshot.newCandidates.yesterday.date}): ${mockSnapshot.newCandidates.yesterday.count}
Escolaridad: Preparatoria(400), Secundaria(200), Universidad(150), Sin escolaridad(50)
Género: Femenino(550), Masculino(250)
`;

const systemPrompt = `
Eres Brenda Rodriguez, copiloto interno de Candidatic IA.
Tienes acceso a datos REALES de la base de candidatos.

Reglas:
- Responde en español natural, claro y ejecutivo.
- Usa SOLO los datos proporcionados. No inventes números.
- Para preguntas de conteo, usa las distribuciones de ESTADÍSTICAS.

ESTADÍSTICAS:
${compactStats}
`;

async function run() {
    console.log("Consultando a Brenda (simulando que usamos tu propia API de OpenAI)...");
    
    // As we don't have OPENAI_API_KEY in local, we just print the prompt that Brenda gets
    console.log("\n=== PROMPT QUE SE ENVÍA A GPT PARA AHORRAR TOKENS ===");
    console.log(systemPrompt);
    console.log("====================================================\n");
    console.log("BRENDA RESPONDERÍA ALGO COMO: \n'De los 1050 candidatos totales, la escolaridad más repetida es Preparatoria con 400 candidatos, seguida por Secundaria con 200 y Universidad con 150.'");
    
    process.exit(0);
}
run();
