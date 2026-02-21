import { getOpenAIResponse } from '../utils/openai.js';
import { updateCandidate, moveCandidateStep, recordAITelemetry, recordVacancyInteraction } from '../utils/storage.js';

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
[REGLAS DE TRANSICIÓN]:
1. Si el candidato confirma interés, acepta una propuesta o el objetivo del paso se cumple, DEBES incluir el tag "{ move }" en tu "thought_process".
2. 🎯 TRIGGER DE ACEPTACIÓN: Si el historial muestra que YA presentaste la vacante/propuesta Y el candidato responde afirmativamente ("Sí", "Si", "Sí quiero", "Dale", "Va", "Me interesa", "Quiero", "Claro", "Ok", "Cuándo", "Cómo") → DISPARA "{ move }" INMEDIATAMENTE en thought_process. UNA SOLA PALABRA AFIRMATIVA ES SUFICIENTE.
3. 🚨 ANTI-MOVIMIENTO PREMATURO (CRÍTICO): JAMÁS dispares "{ move }" si tú misma no has presentado PRIMERO la información o pregunta de este paso en el historial. Si el candidato apenas dice "ok" o "gracias" por haber completado su perfil, NO ASUMAS que aceptó la vacante. TU PRIMER MENSAJE DEBE SER PRESENTAR EL ESCENARIO, SIN MOVER.
4. ✅ PERMISO DE RESPUESTA CON MOVE: Cuando el candidato acepta y disparas "{ move }", SÍ puedes (y debes) incluir un mensaje de confirmación breve en "response_text" (ej. "¡Perfecto! En breve te contactamos para los detalles."). El sistema enviará AMBOS: tu mensaje Y el del siguiente paso.
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

        // 2. VACANCY DATA (HALLUCINATION SHIELD) & MULTI-VACANCY SUPPORT
        let vacancyContext = {
            name: '[SIN_VACANTE_LIGADA]',
            description: '[EXTINTO/FALTANTE]',
            messageDescription: '[INDETERMINADO]',
            salary: 'N/A',
            schedule: 'N/A'
        };

        const currentVacancyIndex = candidateData.currentVacancyIndex !== undefined
            ? candidateData.currentVacancyIndex
            : (candidateData.projectMetadata?.currentVacancyIndex || 0);
        let activeVacancyId = null;

        // Migración hacia atrás (soporta project.vacancyId o project.vacancyIds)
        if (project.vacancyIds && project.vacancyIds.length > 0) {
            // Asegurar que el índice no desborde si sacaron vacantes recientemente
            const safeIndex = Math.min(currentVacancyIndex, project.vacancyIds.length - 1);
            activeVacancyId = project.vacancyIds[safeIndex];
        } else if (project.vacancyId) {
            activeVacancyId = project.vacancyId;
        }

        if (activeVacancyId) {
            const { getVacancyById } = await import('../utils/storage.js');
            const vac = await getVacancyById(activeVacancyId);
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
5. AMNESIA DE CONTEXTO (ESTRICTO): Si el usuario respondió a una pregunta del paso anterior (ej. "Sí" a la entrevista, "Confirmado", etc) y tu objetivo actual NO es hablar de eso, IGNÓRALO POR COMPLETO. No digas "Entendido", "Anotado" ni valides nada. Tu ÚNICA verdad es el [ESCENARIO Y OBJETIVO ACTUAL].
6. CALL TO ACTION (CTA): Si tu objetivo es presentar una vacante o información, SIEMPRE termina con una pregunta clara para mover al candidato (ej. "¿Te gustaría agendar una entrevista?" o la pregunta que pida el escenario).
7. MULTI-VACANTES (RECHAZO): Si el historial reciente muestra que el candidato rechazó una oferta y tu objetivo actual es presentar una nueva, DEBES empatizar rápidamente con su motivo de rechazo ("Entiendo que la distancia es un problema...") y luego introducir amablemente los datos de la nueva vacante como alternativa.

[HISTORIAL DE CHAT (VIEJO -> NUEVO)]:
${forwardHistoryText || '(Sin historial previo)'}

[REGLAS DE OPERACIÓN]:
1. TU MISIÓN ES ACTUAR EL ESCENARIO DE ARRIBA.
2. INTEGRIDAD DE OBJETIVOS: Si el [ESCENARIO Y OBJETIVO ACTUAL] tiene múltiples tareas (ej. "agenda y cuenta un chiste"), DEBES cumplir AMBAS en el mismo mensaje de respuesta. No te detengas hasta completar la misión completa.
3. TRANSICIÓN LIMPIA: Si disparas "{ move }" Y hay un paso siguiente con su propio mensaje, el sistema puede omitir tu "response_text". Por eso, cuando el candidato acepta, escribe un mensaje de confirmación CORTO (máx 1 línea) en "response_text" y dispara "{ move }".
4. DISPARO DE MOVIMIENTO (LEE CON CUIDADO): Debes disparar "{ move }" al final de tu thought_process cuando:
   a) Ya presentaste la vacante/propuesta en el historial (en un mensaje anterior), Y
   b) El candidato confirmó con cualquier respuesta afirmativa ("Sí", "Si", "Dale", "Claro", "Quiero", "Ok", "Cuándo", etc.).
   👉 EJEMPLO CORRECTO: Si el historial muestra [Brenda: ¿Te gustaría agendar?] → [Candidato: Si] → TU THOUGHT_PROCESS DEBE INCLUIR "{ move }".
5. FORMATO DE RESPUESTA: JSON OBLIGATORIO.
{
    "thought_process": "Razonamiento detallado. INCLUYE '{ move }' al final si el candidato aceptó la propuesta presentada en el historial.",
    "response_text": "Mensaje natural y breve para el candidato (ej. '¡Listo! En breve te contactamos. ✨').",
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

        // 5. Lógica de Movimiento { move } y Rastreo de Vacantes
        if (activeVacancyId) {
            if (aiResult.thought_process?.includes('{ move }')) {
                console.log(`[RECRUITER BRAIN] ⚡ Mission Accomplished detected for candidate ${candidateId}. Recording ACCEPTED.`);
                // El candidato aceptó la propuesta/cita de la vacante actual
                await recordVacancyInteraction(candidateId, project.id, activeVacancyId, 'ACCEPTED', 'Progreso de etapa');
            } else {
                // Si no se movió, significa que la vacante está siendo DISCUTIDA o MOSTRADA
                // Registramos SHOWN solo si es el primer acercamiento (esto puede afinarse revisando el history, 
                // pero por robustez, un zadd con mismo ID/score sobreescribe limpiamente sin duplicar infinitamente)
                await recordVacancyInteraction(candidateId, project.id, activeVacancyId, 'SHOWN', 'Presentación/Resolución de dudas');
            }
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
