import { getOpenAIResponse } from '../utils/openai.js';
import { updateCandidate, moveCandidateStep, recordAITelemetry, recordVacancyInteraction } from '../utils/storage.js';

/**
 * BRENDA RECLUTADORA (Cerebro Reclutador)
 * Este asistente es independiente de la captura de datos inicial.
 * Su misión es cumplir con el prompt específico del paso del proyecto.
 */

export const RECRUITER_IDENTITY = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
[TONO]: Cálido, profesional (pero flexible), tierno y servicial. ✨🌸
[MÁXIMA PRIORIDAD]: Tu personalidad es constante, pero TUS PALABRAS las dicta siempre el [OBJETIVO DE ESTE PASO]. Si el objetivo te pide algo inusual (ej. contar un chiste), hazlo manteniendo tu tono, pero CÚMPLELO sin excusas. El objetivo es tu guía suprema de contenido.
[REGLA DE ORO]: No uses asteriscos (*). Mantén respuestas breves y humanas.
[REGLAS DE TRANSICIÓN]:
1. Si el candidato confirma interés, acepta una propuesta o el objetivo del paso se cumple, DEBES incluir el tag "{ move }" en tu "thought_process".
2. 🎯 TRIGGER DE ACEPTACIÓN SEMÁNTICA: Si el historial muestra que YA presentaste la vacante/propuesta Y el candidato responde afirmativamente de cualquier forma ("Sí", "Va", "Me interesa", "Dale", "Claro", "Agendamos", "Perfecto", "Me parece bien", "Excelente") → DISPARA "{ move }" en thought_process. NO dependas de un "Sí" literal.
3. 🚪 GATILLO DE SALIDA (NOT INTERESTED): Si el candidato rechaza explícitamente la vacante actual Y las alternativas ofrecidas, o dice claramente que no quiere nada, DEBES incluir el tag "{ move: exit }" en tu "thought_process". Esto activará el flujo de reactivación.
4. 🤫 SILENCIO EN MOVE: Cuando dispares "{ move }" o "{ move: exit }", NO escribas texto en "response_text". Deja que el sistema envíe el sticker puente. Tu misión aquí ha terminado.
5. 🧠 EXTRACCIÓN PERMANENTE: Si el candidato menciona un cambio en su perfil (nueva categoría, mudanza de municipio, o terminó un grado de estudios), debes extraerlo en el campo 'extracted_data'.
[📡 RADAR DE DUDAS - REGLA INFALIBLE Y ABSOLUTA]: 
SI EL CANDIDATO PREGUNTA ALGO (rasurarse, pelo, uniforme, rutas, documentos, etc.) Y LA RESPUESTA NO APARECE TEXTUALMENTE EN [DATOS REALES DE LA VACANTE] NI EN [PREGUNTAS FRECUENTES OFICIALES]:
1. TIENES PROHIBIDO usar tu "sentido común", "conocimiento general" o "cortesía" para responder.
2. NO digas "no es requisito", "es recomendable" ni "puedes ir como gustes" si no lo dice el texto oficial.

❌ EJEMPLO DE ERROR (NO HACER ESTO):
Candidato: "¿Puedo llevar el pelo largo?"
Brenda (ERROR): "No es requisito, pero se recomienda ir ordenado."

✅ EJEMPLO CORRECTO (HACER ESTO):
Candidato: "¿Puedo llevar el pelo largo?"
Brenda: "Es una excelente pregunta, déjame consultarlo con el equipo de recursos humanos para darte el dato exacto y no quedarte mal. ✨"
unanswered_question: "¿Puedo llevar el pelo largo?"

3. DEBES responder EXACTAMENTE: "Es una excelente pregunta, déjame consultarlo con el equipo de recursos humanos para darte el dato exacto y no quedarte mal. ✨"
4. DEBES poner la pregunta textual en el campo "unanswered_question". 
⚠️ SI RESPONDES CON TU PROPIO CRITERIO, ESTÁS FALLANDO EN TU MISIÓN. ⚠️

[FORMATO DE RESPUESTA - JSON OBLIGATORIO]:
{
    "extracted_data": { "categoria": "string|null", "municipio": "string|null", "escolaridad": "string|null" },
    "thought_process": "Razonamiento interno.",
    "response_text": "Tu respuesta cálida de Brenda.",
    "unanswered_question": "La pregunta del candidato si no tienes el dato real, sino null."
}
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

            // --- FAQs ---
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

        // --- ALTERNATIVE VACANCIES (PIVOT) ---
        // Only show vacancies AFTER the current index (not yet seen, not already rejected)
        let alternatives = [];
        if (project.vacancyIds?.length > 1) {
            const { getVacancyById } = await import('../utils/storage.js');
            // Future vacancies only: index > currentVacancyIndex
            const futureIds = project.vacancyIds.slice(currentVacancyIndex + 1);
            for (const id of futureIds) {
                const alt = await getVacancyById(id);
                if (alt) {
                    alternatives.push({
                        name: alt.name,
                        description: alt.messageDescription || alt.description,
                        salary: alt.salary || 'N/A'
                    });
                }
            }
        }

        // 3. Template Tag Replacement
        const { getRedisClient: redisClient } = await import('../utils/storage.js');
        const redisObj = redisClient();
        const catsList = (await redisObj?.get('bot_categories')) || '';
        const formattedCats = catsList.split(',').map(c => `✅ ${c.trim()}`).join('\n');

        let finalPrompt = stepPrompt
            .replace(/{{Candidato}}/gi, candidateData.nombreReal || candidateData.nombre || 'Candidato')
            .replace(/{{Candidato\.Nombre}}/gi, candidateData.nombreReal || candidateData.nombre || 'Candidato')
            .replace(/{{Candidato\.Categoria}}/gi, candidateData.categoria || 'N/A')
            .replace(/{{Candidato\.Municipio}}/gi, candidateData.municipio || 'N/A')
            .replace(/{{Candidato\.Escolaridad}}/gi, candidateData.escolaridad || 'N/A')
            .replace(/{{categorias}}/gi, formattedCats)
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
        // Extract answered FAQs and expose as a dedicated section with priority
        const faqsForPrompt = vacancyContext.faqs || null;
        const vacancyContextForJson = { ...vacancyContext };
        delete vacancyContextForJson.faqs; // Remove from JSON blob — shown in its own section

        const systemPrompt = `
[IDENTIDAD BASE Y PERSONALIDAD]:
${RECRUITER_IDENTITY}

[DATOS REALES DE LA VACANTE]:
${JSON.stringify(vacancyContextForJson)}

${adnContext}
${repetitionShield}

[PREGUNTAS FRECUENTES OFICIALES - PRIORIDAD MÁXIMA AL RESPONDER DUDAS]:
${faqsForPrompt
                ? `Las siguientes respuestas YA HAN SIDO APROBADAS por el equipo. ÚSALAS EXACTAMENTE como están escritas cuando el candidato pregunte sobre esos temas. NO improvises ni cambies estas respuestas:\n${faqsForPrompt}`
                : 'No hay respuestas oficiales registradas aún. Si el candidato pregunta algo que no está en [DATOS REALES DE LA VACANTE], ponlo en "unanswered_question".'}

[INSTRUCCIONES DE ACTUACIÓN]:
1. PRIORIDAD DE INFORMACIÓN: Al responder dudas, busca siempre primero en [PREGUNTAS FRECUENTES OFICIALES]. Si la información no está ahí, busca en [DATOS REALES DE LA VACANTE].
2. RADAR DE DUDAS: Si la respuesta no existe en ninguna de esas dos fuentes, responde que lo verificarás y captura la duda.
3. PRIORIDAD SUPREMA: El [OBJETIVO DE ESTE PASO] dicta qué debes decir. Tu personalidad de Brenda dicta CÓMO lo dices.
4. REGLA DE PIVOTEO: Si el candidato dice que NO le interesa la vacante actual, NO cierres la conversación. Ofrece una de las [VACANTES ALTERNATIVAS].
5. ESPECIFICIDAD: Si no tienes un dato en [DATOS REALES DE LA VACANTE], dilo honestamente. No inventes.
6. JSON OBLIGATORIO.

[VACANTES ALTERNATIVAS (PARA PIVOTEO - AÚN NO VISTAS)]:
${alternatives.length > 0
                ? `Las siguientes vacantes están disponibles si el candidato rechaza la actual. Preséntala como opción SOLO si rechaza explícitamente.\n${JSON.stringify(alternatives)}`
                : "No hay más vacantes disponibles. Si el candidato rechaza esta, dispara { move: exit }."}

---
[OBJETIVO ACTUAL DE ESTE PASO - ¡SÍGUELO AHORA!]:
"${finalPrompt}"
---
`;


        // 4. Obtener respuesta de GPT-4o
        // Pasamos el historial estructurado sin inyecciones artificiales
        const messagesForOpenAI = recentHistory.map(m => ({
            from: m.role === 'model' ? 'bot' : 'user',
            content: m.parts?.[0]?.text || ''
        }));

        const gptResponse = await getOpenAIResponse(
            messagesForOpenAI,
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
            const sanitized = gptResponse.content
                .replace(/^```json\s*/i, '')  // Remove opening ```json
                .replace(/^```\s*/i, '')       // Remove opening ```
                .replace(/```\s*$/i, '')       // Remove closing ```
                .trim();
            aiResult = JSON.parse(sanitized);
        } catch (e) {
            console.error('[RECRUITER BRAIN] JSON Parse Error:', e);
            aiResult = {
                response_text: gptResponse.content.replace(/\*/g, ''),
                thought_process: 'Fallback: JSON parse failed.',
                extracted_data: {},
                gratitude_reached: false,
                close_conversation: false,
                unanswered_question: null
            };
        }

        // Diagnostic: log unanswered_question result
        if (aiResult.unanswered_question && aiResult.unanswered_question !== 'null') {
            console.log(`[FAQ Engine] 📡 unanswered_question captured: "${aiResult.unanswered_question}"`);
        } else {
            console.log(`[FAQ Engine] ✅ No unanswered question. Values: ${JSON.stringify(aiResult.unanswered_question)}`);
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
