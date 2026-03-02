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
2. 🎯 TRIGGER DE ACEPTACIÓN SEMÁNTICA: Si el historial muestra que YA presentaste la vacante/propuesta Y el candidato responde afirmativamente de cualquier forma ("Sí", "Va", "Me interesa", "Dale", "Claro", "Agendamos", "Perfecto", "Me parece bien", "Excelente") → DISPARA "{ move }" en thought_process. NO dependas de un "Sí" literal. (NOTA: Excepto en el paso de Cita, ver regla 7).
18. 3. 🚪 GATILLO DE SALIDA (NOT INTERESTED): Si el candidato rechaza explícitamente la vacante actual Y las alternativas ofrecidas, o dice claramente que no quiere nada, DEBES incluir el tag "{ move: exit }" en tu "thought_process". Esto activará el flujo de reactivación.
19. 4. 🤫 SILENCIO EN MOVE: Cuando dispares "{ move }" o "{ move: exit }", NO escribas texto en "response_text". Deja que el sistema envíe el sticker puente. 🚨 ATENCIÓN: Si necesitas decirle ALGO al candidato (responder duda, preguntar si avanza), ¡TIENES ESTRICTAMENTE PROHIBIDO USAR "{ move }"! El tag wipea tu texto.
5. 🧠 EXTRACCIÓN PERMANENTE: Si el candidato menciona un cambio en perfil (nueva categoría, mudanza), extráelo en 'extracted_data'.
6. 🚫 PROHIBICIÓN DE AGENDAR: TIENES PROHIBIDO ofrecer días/horarios a menos que el [OBJETIVO DE ESTE PASO] te lo pida explícitamente (ej. paso "Cita"). En pasos de información, solo invitas ("¿Te gustaría agendar?").
7. 📅 REQUISITO ESTRICTO DE CITA (CONFIRMACIÓN EXPRESA): Si estás en el paso de "Cita", TIENES ESTRICTAMENTE PROHIBIDO usar el tag "{ move }" o dar por hecho la cita solo porque el candidato eligió una hora. DEBES EXIGIR UNA CONFIRMACIÓN FINAL (Paso 3). Solo usarás "{ move }" cuando el candidato responda AFIRMATIVAMENTE a tu pregunta final de validación (ej. "¿Estamos de acuerdo con el Lunes a las 08:00 AM? Sí o No"). Hasta que no diga "Sí" a esa validación, NO te mueves.
[📡 RADAR DE DUDAS - REGLA DE VERDAD]: 
SI EL CANDIDATO PREGUNTA ALGO (rasurarse, pelo, uniforme, rutas, documentos, etc.):
1. PRIORIDAD: Busca la respuesta en [PREGUNTAS FRECUENTES OFICIALES] y luego en [DATOS REALES DE LA VACANTE].
2. RESPUESTA MULTIMEDIA (CRÍTICO): Si la respuesta oficial contiene el tag [MEDIA_DISPONIBLE: url], DEBES copiar ESA "url" EXACTAMENTE en tu campo 'media_url' del JSON. 
   - REGLA DE LIMPIEZA: JAMÁS menciones la palabra "MEDIA_DISPONIBLE" ni pongas la URL dentro del 'response_text'. El 'response_text' solo debe contener tu mensaje cálido. El sistema se encarga de enviar el archivo por separado usando el campo 'media_url'.
3. FLEXIBILIDAD: Se permite la comprensión semántica. Si el tema o la respuesta oficial cubren la intención de la duda (ej. "guaraches" entra en "calzado" o "uniforme"), RESPÓNDELA. No es necesario que la palabra sea idéntica, solo que el dato esté presente en tus fuentes oficiales.
4. PROHIBICIÓN DE INVENCIÓN: Si el dato NO existe de ninguna forma en tus fuentes, NO uses tu criterio. 
5. FALLBACK OBLIGATORIO: Solo si la respuesta es totalmente desconocida, responde EXACTAMENTE: "Es una excelente pregunta, déjame consultarlo con el equipo de recursos humanos para darte el dato exacto y no quedarte mal. ✨" y llena el campo "unanswered_question".

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
    "extracted_data": { "categoria": "string|null", "municipio": "string|null", "escolaridad": "string|null", "citaFecha": "string|null", "citaHora": "string|null" },
    "thought_process": "Razonamiento interno.",
    "response_text": "Tu respuesta cálida de Brenda.",
    "media_url": "URL del archivo multimedia si la duda lo tiene, sino null.",
    "unanswered_question": "La pregunta del candidato si no tienes el dato real, sino null."
}
⚠️ IMPORTANTE: Los campos "citaFecha" y "citaHora" deben llenarse OBLIGATORIAMENTE en cuanto el candidato elija el día y la hora, y mantenerse en el JSON final cuando dispares "{ move }". NUNCA envíes "{ move }" con "citaFecha" o "citaHora" como nulos.
`;


export const processRecruiterMessage = async (candidateData, project, currentStep, recentHistory, config, customApiKey = null, vacancyIndexOverride = undefined) => {
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
            name: '',
            description: '',
            messageDescription: '',
            salary: 'N/A',
            schedule: 'N/A'
        };

        // Use authoritative index passed from agent.js (resolved from project:cand_meta)
        // Fallback chain: override → candidateData → projectMetadata → 0
        const currentVacancyIndex = vacancyIndexOverride !== undefined
            ? vacancyIndexOverride
            : (candidateData.currentVacancyIndex !== undefined
                ? candidateData.currentVacancyIndex
                : (candidateData.projectMetadata?.currentVacancyIndex || 0));
        console.log(`[RECRUITER BRAIN] 📍 vacancyIndex=${currentVacancyIndex} (override=${vacancyIndexOverride})`);
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
                    name: vac.name || '',
                    description: vac.description || '',
                    messageDescription: vac.messageDescription || vac.description || '',
                    salary: vac.salary || 'N/A',
                    schedule: vac.schedule || 'N/A',
                    media_url: vac.media_url || null,
                    documents: vac.documents || []
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
                            vacancyContext.faqs = answeredFaqs.map(f => {
                                const keywords = f.originalQuestions ? ` (Palabras clave: ${f.originalQuestions.join(', ')})` : '';
                                let mUrl = f.mediaUrl || '';
                                if (mUrl && mUrl.startsWith('/api/')) {
                                    mUrl = `https://candidatic.ia${mUrl}`;
                                }
                                const mediaNote = mUrl ? ` [MEDIA_DISPONIBLE: ${mUrl}]` : '';
                                return `- TEMA: "${f.topic}"${keywords}${mediaNote}\n  RESPUESTA OFICIAL: "${f.officialAnswer}"`;
                            }).join('\n');
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
            .replace(/{{Vacante\.MessageDescription}}/gi, vacancyContext.messageDescription || vacancyContext.description || '')
            .replace(/{{Vacante\.Descripcion}}/gi, vacancyContext.description || '')
            .replace(/{{Vacante\.Sueldo}}/gi, vacancyContext.salary || 'N/A')
            .replace(/{{Vacante\.Horario}}/gi, vacancyContext.schedule || 'N/A');

        // 4. Historial en orden CRONOLÓGICO (Viejo -> Nuevo)
        const forwardHistoryText = recentHistory
            .map(m => {
                const role = (m.role === 'model' || m.role === 'assistant') ? 'Brenda' : 'Candidato';
                const text = m.content || m.parts?.[0]?.text || '';
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

        // --- DEBUG DIAGNOSTIC ---
        console.log(`[FAQ DEBUG] 🎯 Candidate: ${candidateData.id} | Project: ${project.id} | ActiveVacancyId: ${activeVacancyId}`);
        if (!faqsForPrompt) {
            console.log(`[FAQ DEBUG] ⚠️ No official FAQs found for vacancy ${activeVacancyId}`);
        } else {
            console.log(`[FAQ DEBUG] ✅ Injected FAQs:\n${faqsForPrompt}`);
        }

        let systemPrompt = `
[FUENTES DE VERDAD - CONSULTAR ANTES DE RESPONDER]:

[PREGUNTAS FRECUENTES OFICIALES - PRIORIDAD MÁXIMA]:
${faqsForPrompt
                ? `Las siguientes respuestas HAN SIDO APROBADAS. ÚSALAS para responder dudas relacionadas:\n${faqsForPrompt}`
                : 'No hay respuestas oficiales registradas aún. Si preguntan algo no listado aquí o abajo, usa el fallback de duda.'}

[DATOS REALES DE LA VACANTE]:
${JSON.stringify(vacancyContextForJson)}

[IDENTIDAD BASE Y PERSONALIDAD]:
${RECRUITER_IDENTITY}

${adnContext}
${repetitionShield}

[OPCIONES DE AGENDA DISPONIBLES]:
${currentStep.calendarOptions && currentStep.calendarOptions.length > 0
                ? `⚠️ REGLA ESTRICTA DE AGENDA (FLUJO DE TRES PASOS): Tienes ESTRICTAMENTE PROHIBIDO soltar horarios de golpe y PROHIBIDO cerrar la cita sin confirmar. DEBES seguir esta secuencia exacta:

PASO 1 (OFRECER DÍAS): Si aún no elige día, agrupa los horarios disponibles y ofrece SOLO los días como opciones numeradas. 
🚨 REGLA VISUAL DE DÍAS: DEBES ENVIAR CADA OPCIÓN EN UN RENGLÓN DISTINTO. Tienes ESTRICTAMENTE PROHIBIDO poner dos días en el mismo renglón (ej. "el lunes 2 y martes 3").
Ejemplo de formato que DEBES seguir:
"¡Excelente! Tengo estos días disponibles para tu entrevista: 

1️⃣ Lunes 2 de Marzo

2️⃣ Martes 3 de Marzo

¿Qué día prefieres?"

PASO 2 (OFRECER HORARIOS): CUANDO el candidato ya eligió un día explícitamente, ofrécele SOLO las horas disponibles para ese día exacto en viñetas (🔹 Opción 1: 08:00 AM).
🚨 REGLA VISUAL DE HORAS: DEBES ENVIAR CADA HORA EN UN RENGLÓN DISTINTO.
Ejemplo:
"Perfecto, para el Lunes 2 de Marzo tengo estas opciones de horario para ti:

🔹 Opción 1: 08:00 AM

🔹 Opción 2: 08:30 AM

¿Cuál prefieres?"

PASO 3 (CONFIRMACIÓN FINAL - CRÍTICO): CUANDO el candidato ya eligió LA HORA, tienes ESTRICTAMENTE PROHIBIDO asumir que terminaste y lanzar el tag { move }. DEBES retroalimentarle su elección y hacer una PREGUNTA FINAL de confirmación (Sí/No).
Ejemplo EXACTO de tu mensaje en este paso:
"Ok Oscar, entonces agendamos tu cita para entrevista el día Martes 3 de Marzo a las 08:00 AM, ¿estamos de acuerdo?"

SOLO CUANDO el candidato responda con una afirmación ("Sí", "Ok", "Perfecto") a ESA pregunta del PASO 3, entonces (y solo entonces) disparas el tag "{ move }" en tu thought_process (y guardas silencio en response_text).

Estos son todos tus horarios brutos disponibles (YYYY-MM-DD @ HH:mm):
${currentStep.calendarOptions.map((opt) => `- ${opt}`).join('\n')}

NUNCA inventes horarios que no estén en esta lista.`
                : 'No hay horarios preconfigurados, pregunta por su disponibilidad general.'}

[OPCIONES DE CIERRE DE ENTREVISTA (USO ALEATORIO)]:
- ¿Te gustaría que te agende una cita para entrevista?
- ¿Te puedo agendar una cita de entrevista?
- ¿Deseas que programe tu cita de entrevista?
- ¿Te interesa que asegure tu cita para entrevista?
- ¿Te confirmo tu cita de entrevista?
- ¿Quieres que reserve tu cita para entrevista?
- ¿Procedo a agendar tu cita de entrevista?
- ¿Te aparto una cita para tu entrevista?
- ¿Avanzamos con tu cita de entrevista?
- ¿Autorizas que agende tu cita para entrevista?

[INSTRUCCIONES DE ACTUACIÓN]:
1. PRIORIDAD: Al responder dudas, busca siempre primero en [PREGUNTAS FRECUENTES OFICIALES] (uso semántico permitido).
2. RADAR DE DUDAS: Solo si la respuesta NO existe en las fuentes mencionadas, usa el fallback y captura en "unanswered_question".
3. REGLA DE EXCLUSIVIDAD (OVERRIDE): Si el [OBJETIVO ACTUAL DE ESTE PASO] dice que busques "EXCLUSIVAMENTE" en una fuente, considera que las [PREGUNTAS FRECUENTES OFICIALES] SON parte de esa fuente oficial y SIEMPRE deben ser consultadas.
4. PRIORIDAD SUPREMA: El [OBJETIVO DE ESTE PASO] dicta qué debes decir. Tu personalidad de Brenda dicta CÓMO lo dices.
5. REGLA DE PIVOTEO: Si el candidato rechaza la vacante actual, ofrece una de las [VACANTES ALTERNATIVAS].
6. OBLIGACIÓN DE CIERRE: ⚠️ SIN IMPORTAR QUÉ PREGUNTE EL CANDIDATO O CÓMO LE RESPONDAS, DEBES TERMINAR TU MENSAJE EXACTAMENTE CON UNA PREGUNTA PARA AGENDAR. 
   - Si no estás ofreciendo días específicos aún, ELIGE ALEATORIAMENTE UNA SOLA PREGUNTA de la lista [OPCIONES DE CIERRE DE ENTREVISTA]. NUNCA uses la misma pregunta siempre.
   - NUNCA termines una respuesta con "Si tienes dudas, avísame" ni frases abiertas.
7. JSON OBLIGATORIO.
8. 🎯 REGLA DE RETOMA DE CONTROL Y PROHIBICIÓN DE MOVE (CRÍTICA): Si el candidato te hace una pregunta (ej. "¿dónde está la empresa?"), primero respóndele amablemente la duda corta y OBLIGATORIAMENTE DEBES cerrar tu mensaje volviendo al [OBJETIVO ACTUAL DE ESTE PASO] haciendo una pregunta de cierre (ej. "¿Avanzamos con tu cita de entrevista?"). 
   🚨 REGLA ESTRICTA: CUANDO RESPONDES UNA DUDA, TIENES ESTRICTAMENTE PROHIBIDO INCLUIR EL TAG "{ move }" EN TU THOUGHT_PROCESS. El candidato SÓLO preguntó, NO HA ACEPTADO AÚN. Si incluyes "{ move }", el sistema borrará tu respuesta y dejarás al candidato en visto.

[VACANTES ALTERNATIVAS]:
${alternatives.length > 0
                ? JSON.stringify(alternatives)
                : "No hay más vacantes disponibles."}

---
[OBJETIVO ACTUAL DE ESTE PASO]:
"${finalPrompt}"
---
`;

        // --- MULTIMODAL KNOWLEDGE BASE SUPPORT ---
        let multimodalDocuments = null;
        let hasHardcodedTextDocuments = false;
        if (vacancyContext.documents && vacancyContext.documents.length > 0) {
            multimodalDocuments = [];
            let iDoc = 1;
            for (const doc of vacancyContext.documents) {
                if (doc.extractedText) {
                    systemPrompt += `\n[DOCUMENTO ADJUNTO ${iDoc} ("${doc.name}")]:\n${doc.extractedText}\n`;
                    hasHardcodedTextDocuments = true;
                    iDoc++;
                } else if (doc.type && doc.type.startsWith('image/')) {
                    multimodalDocuments.push({
                        type: "text",
                        text: `Documento Adjunto (${iDoc}): "${doc.name}"`
                    });
                    multimodalDocuments.push({
                        type: "image_url",
                        image_url: { url: doc.url }
                    });
                    iDoc++;
                }
                // future expansion: pdf parsing
            }
            if (multimodalDocuments.length > 0) {
                systemPrompt += `\n\n[BASE DE CONOCIMIENTO MULTIMODAL ADJUNTA]:\nTienes acceso a imágenes adjuntas (Rutas, Mapas, Reglamentos). **ÉSTOS DEBEN SER TU ÚNICA FUENTE DE VERDAD** para dudas técnicas que dependan de ellos. Léelos detenidamente antes de contestar.\n`;
            } else {
                multimodalDocuments = null;
            }
            if (hasHardcodedTextDocuments) {
                systemPrompt += `\n\n[BASE DE CONOCIMIENTO TEXTUAL ADJUNTA]:\nTienes información extraída previamente de adjuntos mostrada arriba. **ESTA DEBE SER TU ÚNICA FUENTE DE VERDAD** para dudas técnicas que dependan de ella.\n`;
            }
        }


        // 4. Obtener respuesta de GPT-4o
        // Pasamos el historial estructurado sin inyecciones artificiales
        const messagesForOpenAI = recentHistory.map(m => ({
            role: (m.role === 'model' || m.role === 'assistant') ? 'assistant' : 'user',
            content: m.content || m.parts?.[0]?.text || ''
        }));

        const gptResponse = await getOpenAIResponse(
            messagesForOpenAI,
            systemPrompt,
            'gpt-4o', // Upgraded to 4o to support Multimodal Image reading
            customApiKey,
            { type: 'json_object' },
            multimodalDocuments
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
