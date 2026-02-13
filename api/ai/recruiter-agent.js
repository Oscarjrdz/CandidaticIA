import { getOpenAIResponse } from '../utils/openai.js';
import { updateCandidate, moveCandidateStep, recordAITelemetry } from '../utils/storage.js';

/**
 * BRENDA RECLUTADORA (Cerebro Reclutador)
 * Este asistente es independiente de la captura de datos inicial.
 * Su misión es cumplir con el prompt específico del paso del proyecto.
 */

export const RECRUITER_IDENTITY = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
[TONO]: Cálido, profesional, tierno y servicial. ✨🌸
[DIFERENCIA]: Ya no eres una capturadora de datos. Ahora eres una reclutadora que acompaña al candidato en su proceso de selección dentro de un proyecto específico.
[REGLA DE ORO]: No uses asteriscos (*). Mantén respuestas breves y humanas.
`;

export const processRecruiterMessage = async (candidateData, project, currentStep, recentHistory, config) => {
    const startTime = Date.now();
    const candidateId = candidateData.id;

    try {
        console.log(`[RECRUITER BRAIN] 🧠 Processing candidate ${candidateId} in step: ${currentStep.name}`);

        const stepPrompt = currentStep.aiConfig?.prompt || 'Continúa la conversación amablemente.';
        const vacancyName = project.vacancyName || 'la posición';

        // 1. Inyectar Contexto del Candidato (ADN)
        const adnContext = `
[CONTEXTO DEL CANDIDATO (ADN)]:
- Nombre: ${candidateData.nombreReal || 'Candidato'}
- Categoría: ${candidateData.categoria || 'N/A'}
- Municipio: ${candidateData.municipio || 'N/A'}
- Escolaridad: ${candidateData.escolaridad || 'N/A'}
- Proyecto Actual: ${project.name}
- Paso Actual: ${currentStep.name}
`;

        // 2. Construir Instruction Maestra
        const systemPrompt = `
${RECRUITER_IDENTITY}
${adnContext}

[MISIÓN DEL PASO]:
${stepPrompt}

[REGLAS DE OPERACIÓN]:
1. OLVIDA el comportamiento de pedir datos básicos (ya los tienes).
2. Enfócate 100% en cumplir el objetivo del [MISIÓN DEL PASO].
3. Si el candidato cumple con el objetivo marcado en la misión, incluye la palabra clave { move } en tu "thought_process".
4. FORMATO DE RESPUESTA: Debes responder en JSON con este esquema:
{
    "thought_process": "Tu razonamiento interno.",
    "response_text": "Tu mensaje de Brenda para el candidato.",
    "close_conversation": false
}
`;

        // 3. Obtener respuesta de GPT-4o
        const gptResponse = await getOpenAIResponse(
            recentHistory,
            systemPrompt,
            'gpt-4o', // Usamos GPT-4o para máxima obediencia
            null // Usará la API KEY configurada globalmente
        );

        if (!gptResponse || !gptResponse.content) {
            throw new Error('GPT Response empty');
        }

        // 4. Parsear respuesta
        let aiResult;
        try {
            const sanitized = gptResponse.content.replace(/```json|```/g, '').trim();
            aiResult = JSON.parse(sanitized);
        } catch (e) {
            console.error('[RECRUITER BRAIN] JSON Parse Error:', e);
            aiResult = {
                response_text: gptResponse.content.replace(/\*/g, ''),
                thought_process: 'Fallback: JSON parse failed.'
            };
        }

        // 5. Lógica de Movimiento { move }
        if (aiResult.thought_process?.includes('{ move }')) {
            console.log(`[RECRUITER BRAIN] ⚡ Mission Accomplished! Moving candidate ${candidateId} to next step.`);
            await moveCandidateStep(candidateId); // Esta función asume que avanza al siguiente ID del arreglo de steps
        }

        // 6. Telemetría
        const duration = Date.now() - startTime;
        recordAITelemetry({
            model: 'gpt-4o-recruiter',
            latency: duration,
            candidateId: candidateId,
            action: 'recruiter_inference'
        }).catch(() => { });

        return aiResult;

    } catch (error) {
        console.error('[RECRUITER BRAIN] ❌ Critical Error:', error.message);
        throw error;
    }
};
