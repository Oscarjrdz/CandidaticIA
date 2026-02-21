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
                            vacancyContext.faqsList = answeredFaqs; // Keep a reference
                            vacancyContext.faqs = answeredFaqs.map(f => `- Q: ${f.topic} (ID: ${f.id})\n  A: ${f.officialAnswer}`).join('\n');
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

        // 5. REPETITION SHIELD (HARD PRE-DETECTION)
        const descriptionClean = (vacancyContext.messageDescription || '').toLowerCase().trim();
        const hasSentDescription = descriptionClean && forwardHistoryText.toLowerCase().includes(descriptionClean.substring(0, 100));
        const repetitionShield = hasSentDescription
            ? `\n🚨 [ESCUDO DE REPETICIÓN ACTIVO]: El historial muestra que YA enviaste la descripción de la vacante. PROHIBIDO volver a enviarla completa. Si el candidato pregunta algo, responde solo la duda de forma concisa.\n`
            : "";

        // 6. Construir Instruction Maestra
        const systemPrompt = `
[PREGUNTAS FRECUENTES (RESPUESTAS OFICIALES)]:
${vacancyContext.faqs || '(No hay FAQs registradas aún. Si preguntan algo fuera de los datos reales, responde con honestidad según la regla 3)'}

[ESCENARIO Y OBJETIVO ACTUAL]:
"${finalPrompt}"

---
[IDENTIDAD RECLUTADORA]: 
${RECRUITER_IDENTITY}

${adnContext}
${repetitionShield}

[DATOS REALES DE LA VACANTE]:
${JSON.stringify(vacancyContext)}

REGLAS DE ACTUACIÓN PROFESIONAL:
1. PRIORIDAD QUIRÚRGICA DE FAQ (CRÍTICA): Las respuestas en [PREGUNTAS FRECUENTES] sobreescriben CUALQUIER otra información. Si hay una contradicción entre la ficha técnica ([DATOS REALES DE LA VACANTE]) y lo que dice el Radar ([PREGUNTAS FRECUENTES]), el Radar SIEMPRE tiene la razón. Ignora la descripción técnica si contradice a una FAQ oficial.
2. EXTRACCIÓN OBLIGATORIA (RADAR): DEBES extraer CUALQUIER duda, pregunta, "No entendí" o consulta al campo "unanswered_question". Hazlo incluso si ya respondiste la duda. Si el candidato parece confundido, extrae el motivo de su confusión.
3. HONESTIDAD Y ESPECIFICIDAD: Si el candidato pregunta algo que NO está en el contexto, NO seas evasiva. Responde: "No tengo el dato exacto de [tema] aquí a la mano, pero déjame preguntarlo por ti. 😊".
4. REGLA DE NO REDUNDANCIA: Si el [ESCUDO DE REPETICIÓN ACTIVO] está presente, NO repitas la descripción masiva de la vacante.
5. PRIORIDAD A DUDAS: Responde dudas de forma breve y humana. NO uses el momento de una duda para repetir todo el pitch.
6. CALL TO ACTION (CTA) OBLIGATORIO: Siempre termina con una invitación (ej. "¿Te interesa agendar?").
7. ANTI-BOT: Varía tus saludos. Sé creativa.
8. ADJUNTO DE VACANTE: Si en tu mensaje estás presentando la vacante por primera vez, o si el usuario pide información general de ella, y observas en [DATOS REALES] que tiene \`mediaType\` configurado, DEBES incluir "send_vacancy_media": true en tu JSON. De lo contrario, pon false.

[HISTORIAL DE CHAT (VIEJO -> NUEVO)]:
${forwardHistoryText || '(Sin historial previo)'}

[REGLAS DE OPERACIÓN]:
1. TU MISIÓN ES ACTUAR EL ESCENARIO, pero la REGLA DE PRECEDENCIA DE FAQ y NO REDUNDANCIA mandan.
2. DISPARO DE MOVIMIENTO — REGLA ABSOLUTA: Debes escribir "{ move }" al final de "thought_process" cuando el candidato aceptó explícitamente.
3. FORMATO DE RESPUESTA: JSON OBLIGATORIO. PRECAUCIÓN DE EXTRACCIÓN: En "extracted_data", si preguntas por empleo y responden "no", "desempleado", etc., debes poner "No" en "tieneEmpleo". Si es "sí", pon "Si".
4. MATCHED FAQ ID: Si tu respuesta a una pregunta del candidato viene de la lista [PREGUNTAS FRECUENTES], DEBES incluir el campo "matched_faq_id" con el ID exacto de la FAQ usada. Si no usaste ninguna FAQ para responder, pon null.
   
⚡ EJEMPLO DE USO DE FAQ Y EXTRACCIÓN:
Si preguntan por el sueldo y está en FAQs con ID "xt31":
{
    "thought_process": "El candidato pregunta por el sueldo. Consulto [PREGUNTAS FRECUENTES] y veo que son 10k. Usaré el ID xt31. Responderé y extraeré la pregunta para el Radar.",
    "response_text": "¡Claro! El sueldo es de $10,000 mensuales más prestaciones. 😊 ¿Te interesa agendar entrevista?",
    "unanswered_question": "¿Cuánto pagan?",
    "matched_faq_id": "xt31",
    "send_vacancy_media": false,
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
            'gpt-4o-mini',
            customApiKey
        );

        if (!gptResponse || !gptResponse.content) {
            throw new Error('GPT Response empty');
        }

        console.log(`[RECRUITER BRAIN] 🤖 GPT Response for ${candidateId}: `, gptResponse.content);

        let cleanContent = gptResponse.content.trim();
        // 4. Parsear respuesta
        let aiResult;
        try {
            const sanitized = gptResponse.content.replace(/```json | ```/g, '').trim();
            aiResult = JSON.parse(sanitized);
        } catch (e) {
            console.error('[RECRUITER BRAIN] JSON Parse Error:', e);
            aiResult = {
                response_text: gptResponse.content.replace(/\*/g, ''),
                thought_process: 'Fallback: JSON parse failed.',
                matched_faq_id: null,
                send_vacancy_media: false,
                gratitude_reached: false,
                close_conversation: false
            };
        }

        // Attach matched FAQ object to aiResult for media handling upstream
        if (aiResult.matched_faq_id && vacancyContext.faqsList) {
            const matchedFaq = vacancyContext.faqsList.find(f => f.id === aiResult.matched_faq_id);
            if (matchedFaq) {
                aiResult.matched_faq_object = matchedFaq;
                console.log(`[RECRUITER BRAIN] 📎 Attached FAQ Media Object from ID: ${aiResult.matched_faq_id}`);
            }
        }

        // Attach global vacancy media if requested by the AI
        if (aiResult.send_vacancy_media && vacancyContext.mediaType && vacancyContext.mediaType !== '') {
            aiResult.matched_vacancy_media_object = {
                mediaType: vacancyContext.mediaType,
                mediaUrl: vacancyContext.mediaUrl,
                locationLat: vacancyContext.locationLat,
                locationLng: vacancyContext.locationLng,
                locationAddress: vacancyContext.locationAddress
            };
            console.log(`[RECRUITER BRAIN] 📎 Attached Global Vacancy attached Media`);
        }

        // 5. Lógica de Movimiento { move } y Rastreo de Vacantes
        if (activeVacancyId) {
            if (aiResult.thought_process?.includes('{ move }')) {
                console.log(`[RECRUITER BRAIN] ⚡ Mission Accomplished detected for candidate ${candidateId}.Recording ACCEPTED.`);
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
        recordAITelemetry(candidateId, 'recruiter_inference', {
            model: 'gpt-4o-mini-recruiter',
            latency: duration
        }).catch(() => { });

        return aiResult;

    } catch (error) {
        console.error('[RECRUITER BRAIN] ❌ Critical Error:', error.message);
        throw error;
    }
};
