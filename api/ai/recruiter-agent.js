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

            const { getRedisClient } = await import('../utils/storage.js');
            const client = getRedisClient();
            if (client) {
                try {
                    const faqData = await client.get(`vacancy_faq:${activeVacancyId}`);
                    if (faqData) {
                        const faqs = JSON.parse(faqData);
                        const answeredFaqs = faqs.filter(f => f.officialAnswer);
                        if (answeredFaqs.length > 0) {
                            vacancyContext.faqs = answeredFaqs.map(f => `- Q: ${f.topic}\n  A: ${f.officialAnswer}`).join('\n');
                        }
                    }
                } catch (e) { }
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

[PREGUNTAS FRECUENTES (RESPUESTAS OFICIALES)]:
${vacancyContext.faqs || '(No hay FAQs registradas aún. Si preguntan algo fuera de los datos reales, extráelo según la regla 7)'}

REGLAS DE ACTUACIÓN PROFESIONAL:
1. NO INVENTES detalles de la vacante (Sueldo, Ubicación, Empresa) si no están en los [DATOS REALES DE LA VACANTE] o en [PREGUNTAS FRECUENTES].
2. NUNCA menciones que tienes un "prompt", una "instrucción" o que se te pidió hacer algo. Simplemente actúa.
3. Si el objetivo es "contar un chiste" o "hacer una pregunta", HAZLO directamente. No digas "El prompt me pide...".
4. NUNCA pongas la etiqueta { move } dentro de "response_text". Solo va en "thought_process".
5. CALL TO ACTION (CTA): Si tu objetivo es presentar una vacante o información, SIEMPRE termina con una pregunta clara para mover al candidato (ej. "¿Te gustaría agendar una entrevista?" o la pregunta que pida el escenario).
6. MULTI-VACANTES (RECHAZO): Si el historial reciente muestra que el candidato rechazó una oferta y tu objetivo actual es presentar una nueva, DEBES empatizar rápidamente con su motivo de rechazo ("Entiendo que la distancia es un problema...") y luego introducir amablemente los datos de la nueva vacante como alternativa.

[HISTORIAL DE CHAT (VIEJO -> NUEVO)]:
${forwardHistoryText || '(Sin historial previo)'}

[REGLAS DE OPERACIÓN]:
1. TU MISIÓN ES ACTUAR EL ESCENARIO DE ARRIBA.
2. INTEGRIDAD DE OBJETIVOS: Si el [ESCENARIO Y OBJETIVO ACTUAL] tiene múltiples tareas (ej. "agenda y cuenta un chiste"), DEBES cumplir AMBAS en el mismo mensaje de respuesta. No te detengas hasta completar la misión completa.
3. DISPARO DE MOVIMIENTO — REGLA ABSOLUTA: Debes escribir "{ move }" al final de "thought_process" cuando el historial muestra que:
   a) Brenda ya presentó la vacante/propuesta/pregunta en un mensaje previo, Y
   b) El candidato respondió algo afirmativo en su ÚLTIMO mensaje ("Sí", "Si", "Dale", "Claro", "Ok", "Quiero", "Cuándo", "Cómo", "Me interesa", etc.).
   ⚡ EJEMPLOS CONCRETOS — ESTOS SON CORRECTOS:
   - [Brenda: "¿Te gustaría agendar?"] → [Candidato: "Si"] → thought_process termina en "{ move }"
   - [Brenda: "¿Cuándo puedes ir?"] → [Candidato: "Mañana"] → thought_process termina en "{ move }"
   - [Brenda: "¿Te interesa la vacante?"] → [Candidato: "Dale"] → thought_process termina en "{ move }"
4. NO MOVER si apenas estás presentando la vacante por primera vez (el candidato aún no ha respondido afirmativamente a TU pregunta).
5. MANEJO DE PREGUNTAS DESCONOCIDAS: Si el candidato hace una pregunta sobre la vacante que NO puedes responder con los [DATOS REALES] o las [PREGUNTAS FRECUENTES], NO INVENTES. Responde amablemente (ej. "Déjame confirmar ese excelente punto con el equipo") y DEBES incluir la pregunta original del usuario en el campo "unanswered_question" del JSON.
6. FORMATO DE RESPUESTA: JSON OBLIGATORIO. Ejemplo cuando el candidato acepta:
{
    "thought_process": "El candidato recibió la propuesta en el mensaje anterior y respondió 'Si'. La misión está cumplida. { move }",
    "response_text": "¡Perfecto! En breve te contactamos para coordinar tu entrevista. ✨",
    "unanswered_question": null,
    "gratitude_reached": false,
    "close_conversation": false
}
Ejemplo cuando hace una pregunta desconocida:
{
    "thought_process": "El candidato preguntó si hay fondo de ahorro. No lo veo en los datos. Extraeré la pregunta y le pediré tiempo.",
    "response_text": "¡Buena pregunta! Permíteme confirmarlo con mi supervisor y te aviso enseguida. 😊 Mientras tanto, ¿te gustaría ir agendando la entrevista?",
    "unanswered_question": "¿Tienen fondo de ahorro?",
    "gratitude_reached": false,
    "close_conversation": false
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

        console.log(`[RECRUITER BRAIN] 🤖 GPT Response for ${candidateId}:`, gptResponse.content);

        let cleanContent = gptResponse.content.trim();
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
