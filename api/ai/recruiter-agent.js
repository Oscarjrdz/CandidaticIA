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
[DIFERENCIA]: Ya no eres una capturadora de datos. Ahora eres una reclutadora que acompaña al candidato en su proceso de selección.
[REGLA DE ORO]: No uses asteriscos (*). Mantén respuestas breves y humanas.
`;

export const processRecruiterMessage = async (candidateData, project, currentStep, recentHistory, config, customApiKey = null) => {
    const startTime = Date.now();
    const candidateId = candidateData.id;

    try {
        console.log(`[RECRUITER BRAIN] 🧠 Processing candidate ${candidateId} in step: ${currentStep.name}`);

        const stepPrompt = currentStep.aiConfig?.prompt || 'Continúa la conversación amablemente.';

        // 1. Inyectar Contexto del Candidato (ADN)
        const adnContext = `
[CONTEXTO DEL CANDIDATO (ADN)]:
- Nombre: ${candidateData.nombreReal || 'Candidato'}
- WhatsApp: ${candidateData.whatsapp || 'N/A'}
- Edad: ${candidateData.edad || 'N/A'}
- Género: ${candidateData.genero || 'N/A'}
- Categoría: ${candidateData.categoria || 'N/A'}
- Municipio: ${candidateData.municipio || 'N/A'}
- Escolaridad: ${candidateData.escolaridad || 'N/A'}
- Proyecto Actual: ${project.name}
- Paso Actual: ${currentStep.name}
`;

        // 2. VACANCY DATA (HALLUCINATION SHIELD)
        let vacancyContext = {
            name: '[SIN_VACANTE_LIGADA]',
            description: '[EXTINTO/FALTANTE]',
            messageDescription: '[INDETERMINADO]',
            salary: 'N/A',
            schedule: 'N/A'
        };

        if (project.vacancyId) {
            const { getVacancyById } = await import('../utils/storage.js');
            const vac = await getVacancyById(project.vacancyId);
            if (vac) {
                vacancyContext = {
                    name: vac.name || '[SIN_NOMBRE]',
                    description: vac.description || '[SIN_DESCRIPCION]',
                    messageDescription: vac.messageDescription || vac.description || '[SIN_RESEÑA]',
                    salary: vac.salary || 'N/A',
                    schedule: vac.schedule || 'N/A'
                };
            }
        }

        // 3. Template Tag Replacement
        let finalPrompt = stepPrompt
            .replace(/{{Candidato}}/gi, candidateData.nombreReal || candidateData.nombre || 'Candidato')
            .replace(/{{Vacante}}/gi, vacancyContext.name)
            .replace(/{{Vacante\.MessageDescription}}/gi, vacancyContext.messageDescription || '[ERROR: VACANTE_PARA_MENSAJE_VACIO]')
            .replace(/{{Vacante\.Descripcion}}/gi, vacancyContext.description || '[ERROR: DESCRIPCION_VACANTE_VACIA]')
            .replace(/{{Vacante\.Sueldo}}/gi, vacancyContext.salary || 'N/A')
            .replace(/{{Vacante\.Horario}}/gi, vacancyContext.schedule || 'N/A');

        // 4. Historial en orden CRONOLÓGICO (Viejo -> Nuevo)
        const forwardHistoryText = recentHistory
            .map(m => {
                const role = m.role === 'model' ? 'Brenda' : 'Candidato';
                const text = m.parts?.[0]?.text || '';
                return `[${role}]: ${text}`;
            })
            .join('\n');

        // 5. Construir Instruction Maestra
        const systemPrompt = `
[INSTRUCCIÓN MAESTRA - PRIORIDAD ABSOLUTA]:
"${finalPrompt}"

---
[IDENTIDAD BASE (SOBRESCRITA POR EL PROMPT DE ARRIBA)]: 
${RECRUITER_IDENTITY}

${adnContext}

[DATOS REALES DE LA VACANTE]:
${JSON.stringify(vacancyContext)}

REGLAS DE ORO ANTI-ALUCINACIÓN:
1. NO INVENTES detalles de la vacante (Sueldo, Ubicación, Empresa) si no están en los [DATOS REALES DE LA VACANTE].
2. Si la [INSTRUCCIÓN MAESTRA] contiene un [ERROR: ...], no lo menciones directamente. Dile amablemente que estás validando los detalles del puesto.

[HISTORIAL DE CHAT (VIEJO -> NUEVO)]:
${forwardHistoryText || '(Sin historial previo)'}

[REGLAS DE OPERACIÓN]:
1. TU MISIÓN ES CUMPLIR EL PROMPT DE ARRIBA. Ignora reglas de extracción o registro.
2. Si se cumple el objetivo de la misión (ej: el candidato aceptó o confirmó lo pedido), INCLUYE EL TAG "{ move }" AL FINAL DE TU "thought_process". Esto es vital para que el sistema avance al candidato al siguiente paso.
3. REACCIONES: Si detectas gratitud genuina (Gracias, amables, etc.), pon TRUE en "gratitude_reached".
4. FORMATO DE RESPUESTA: JSON OBLIGATORIO.
{
    "thought_process": "Razonamiento + { move } si aplica.",
    "response_text": "Mensaje para el candidato.",
    "gratitude_reached": boolean,
    "close_conversation": boolean
}
`;

        // 4. Obtener respuesta de GPT-4o
        // NOTA: Pasamos historial vacío a la API porque ya lo inyectamos en el systemPrompt 
        // para asegurar el orden pedido por el usuario y evitar duplicados.
        const gptResponse = await getOpenAIResponse(
            [],
            systemPrompt,
            'gpt-4o',
            customApiKey
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
                thought_process: 'Fallback: JSON parse failed.',
                gratitude_reached: false,
                close_conversation: false
            };
        }

        // 5. Lógica de Movimiento { move } - Handle in agent.js for consistency
        if (aiResult.thought_process?.includes('{ move }')) {
            console.log(`[RECRUITER BRAIN] ⚡ Mission Accomplished detected for candidate ${candidateId}.`);
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
