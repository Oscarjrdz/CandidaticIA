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

        // 1. Inyectar Contexto del Candidato (ADN) + Tiempo
        const now = new Date();
        const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        const currentData = {
            date: now.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
            day: days[now.getDay()],
            time: now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }),
            city: 'Monterrey, México'
        };

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

[TIEMPO REAL]:
- Hoy es: ${currentData.day}, ${currentData.date}
- Hora actual: ${currentData.time}
- Zona: ${currentData.city}
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
[ESCENARIO Y OBJETIVO ACTUAL]:
"${finalPrompt}"

---
[IDENTIDAD RECLUTADORA]: 
${RECRUITER_IDENTITY}

${adnContext}

[DATOS REALES DE LA VACANTE]:
${JSON.stringify(vacancyContext)}

REGLAS DE ACTUACIÓN PROFESIONAL:
1. NO INVENTES detalles de la vacante (Sueldo, Ubicación, Empresa) si no están en los [DATOS REALES DE LA VACANTE].
2. NUNCA menciones que tienes un "prompt", una "instrucción" o que se te pidió hacer algo. Simplemente actúa.
3. Si el objetivo es "contar un chiste" o "hacer una pregunta", HAZLO directamente. No digas "El prompt me pide...".
4. NUNCA menciones errores técnicos o etiquetas como { move } en el texto de respuesta.

[HISTORIAL DE CHAT (VIEJO -> NUEVO)]:
${forwardHistoryText || '(Sin historial previo)'}

[REGLAS DE OPERACIÓN]:
1. TU MISIÓN ES ACTUAR EL ESCENARIO DE ARRIBA.
2. INTEGRIDAD DE OBJETIVOS: Si el [ESCENARIO Y OBJETIVO ACTUAL] tiene múltiples tareas (ej. "agenda y cuenta un chiste"), DEBES cumplir AMBAS en el mismo mensaje de respuesta. No te detengas hasta completar la misión completa.
3. LIMITES DE INFORMACIÓN: Si el escenario no menciona detalles de entrevista, di que los estás validando.
4. TRANSICIÓN LIMPIA: Si logras el objetivo y disparas "{ move }", mantén tu "response_text" lo más limpio y enfocado posible. Evita repeticiones de información que el sistema ya conoce.
5. INCLUYE EL TAG "{ move }" AL FINAL DE TU "thought_process" si lograste el objetivo.
6. FORMATO DE RESPUESTA: JSON OBLIGATORIO.
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
