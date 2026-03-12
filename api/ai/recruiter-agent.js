import { getOpenAIResponse } from '../utils/openai.js';
import { updateCandidate, moveCandidateStep, recordAITelemetry, recordVacancyInteraction, getVacancyById, getRedisClient } from '../utils/storage.js';

/**
 * BRENDA RECLUTADORA (Cerebro Reclutador)
 * Este asistente es independiente de la captura de datos inicial.
 * Su misión es cumplir con el prompt específico del paso del proyecto.
 */

export const RECRUITER_IDENTITY = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
[TONO]: Cálido, profesional, tierno y servicial. ✨🌸
[MÁXIMA PRIORIDAD]: El [OBJETIVO DE ESTE PASO] dicta tus palabras. Cúmplelo siempre.
[REGLA DE ORO]: No uses asteriscos (*). Respuestas breves y humanas.
[REGLAS DE TRANSICIÓN]:
1. Si el candidato confirma interés o el objetivo se cumple, incluye "{ move }" en "thought_process".
2. 🎯 TRIGGER SEMÁNTICO: Si YA presentaste la vacante Y el candidato responde afirmativamente ("Sí", "Va", "Me interesa", "Dale", "Claro", "Perfecto", "Excelente") → DISPARA "{ move }". (Excepto en paso Cita, ver regla 7).
   ⛔ ANTI-TRIGGER: Preguntar sobre detalles (vales, sueldo, horario, lugar, uniforme, beneficios) NO ES aceptación. NUNCA dispares "{ move }" si el candidato hizo una pregunta — respóndela y espera confirmación real.
3. 🚪 SALIDA: Si rechaza la vacante actual Y las alternativas, incluye "{ move: exit }" en thought_process.
4. 🤫 SILENCIO EN MOVE: Al disparar "{ move }" o "{ move: exit }", deja response_text vacío.
5. 🧠 EXTRACCIÓN PERMANENTE: Si mencionan cambio de perfil, extráelo en extracted_data.
6. 🚫 PROHIBICIÓN DE AGENDAR: No ofrezcas días/horarios a menos que el paso lo pida explícitamente.
7. 📅 CITA ESTRICTA: En el paso "Cita", NUNCA uses "{ move }" hasta que el candidato confirme explícitamente ("Sí") a tu pregunta de confirmación final. No lo des por hecho solo por elegir horario.
[📡 RADAR DE DUDAS]:
Si el candidato pregunta algo:
1. PRIORIDAD: Busca en [PREGUNTAS FRECUENTES OFICIALES] luego en [DATOS REALES DE LA VACANTE].
2. MULTIMEDIA: Si la respuesta oficial tiene [MEDIA_DISPONIBLE: url], copia esa url en media_url del JSON. Nunca menciones "MEDIA_DISPONIBLE" ni la url en response_text.
3. FLEXIBILIDAD SEMÁNTICA: Busca por intención, no palabra exacta (ej. "guaraches" → calzado/uniforme).
4. PROHIBICIÓN ABSOLUTA DE INVENCIÓN: Si el dato NO aparece literalmente en [PREGUNTAS FRECUENTES OFICIALES] ni en [DATOS REALES DE LA VACANTE], ESTÁ PROHIBIDO responderlo aunque creas saberlo por conocimiento general. "Puedo trabajar descalzo", "hay casilleros", "necesitan antidoping" — si no está en tus fuentes, ES DESCONOCIDO. Usa el fallback sin excepción.
5. FALLBACK: Si no tienes el dato, responde EXACTAMENTE: "Es una excelente pregunta, déjame consultarlo con el equipo de recursos humanos para darte el dato exacto y no quedarte mal. ✨" y llena unanswered_question.
[FORMATO DE RESPUESTA - JSON OBLIGATORIO]:
{
    "extracted_data": { 
        "categoria": "string|null", 
        "municipio": "string|null", 
        "escolaridad": "string|null", 
        "citaFecha": "YYYY-MM-DD|null (⚠️ RETÉN valor del [ADN] si ya existe)",
        "citaHora": "string|null (⚠️ RETÉN valor del [ADN]. Si elige por número ej. 'opción 3', extrae la HORA EXACTA)" 
    },
    "thought_process": "Razonamiento interno.",
    "response_text": "Tu respuesta cálida de Brenda.",
    "media_url": "URL exacta del [MEDIA_DISPONIBLE] si aplica, sino null.",
    "unanswered_question": "La pregunta del candidato si no tienes el dato, sino null."
}
⚠️ citaFecha y citaHora deben llenarse en cuanto se elijan y mantenerse al disparar "{ move }". NUNCA dispares "{ move }" con citaFecha o citaHora nulos.
`;


export const processRecruiterMessage = async (candidateData, project, currentStep, recentHistory, config, customApiKey = null, vacancyIndexOverride = undefined) => {
    const startTime = Date.now();
    const candidateId = candidateData.id;

    try {

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
- Fecha de Cita: ${candidateData.projectMetadata?.citaFecha || 'No definida'}
- Hora de Cita: ${candidateData.projectMetadata?.citaHora || 'No definida'}

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
            // ⚡ Parallel: vacancy data + FAQ both fetched in one round-trip
            const redisClient = getRedisClient();
            const [vac, faqData] = await Promise.all([
                getVacancyById(activeVacancyId),
                redisClient ? redisClient.get(`vacancy_faq:${activeVacancyId}`).catch(() => null) : Promise.resolve(null)
            ]);

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

            if (faqData) {
                try {
                    const faqs = JSON.parse(faqData);
                    const answeredFaqs = faqs.filter(f => f.officialAnswer);
                    if (answeredFaqs.length > 0) {
                        vacancyContext.faqs = answeredFaqs.map(f => {
                            const keywords = f.originalQuestions ? ` (Palabras clave: ${f.originalQuestions.join(', ')})` : '';
                            let mUrl = f.mediaUrl || '';
                            if (mUrl && mUrl.startsWith('/api/')) mUrl = `https://candidatic.ia${mUrl}`;
                            const mediaNote = mUrl ? ` [MEDIA_DISPONIBLE: ${mUrl}]` : '';
                            return `- TEMA: "${f.topic}"${keywords}${mediaNote}\n  RESPUESTA OFICIAL: "${f.officialAnswer}"`;
                        }).join('\n');
                    }
                } catch (e) { }
            }
        }

        // --- ALTERNATIVE VACANCIES (PIVOT) ---
        let alternatives = [];
        if (project.vacancyIds?.length > 1) {
            const futureIds = project.vacancyIds.slice(currentVacancyIndex + 1);
            if (futureIds.length > 0) {
                const altResults = await Promise.all(futureIds.map(id => getVacancyById(id).catch(() => null)));
                alternatives = altResults
                    .filter(Boolean)
                    .map(alt => ({
                        name: alt.name,
                        description: alt.messageDescription || alt.description,
                        salary: alt.salary || 'N/A'
                    }));
            }
        }

        const redisObj = getRedisClient();
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

        let repetitionShield = "";
        if (hasSentDescription) {
            repetitionShield = `\n🚨 [ESCUDO DE REPETICIÓN ACTIVO]: El historial muestra que YA enviaste la descripción de la vacante. Tienes ESTRICTAMENTE PROHIBIDO volver a enviarla o resumirla. Si el candidato pregunta algo, responde SOLO la duda corta y avanza al [OBJETIVO ACTUAL DE ESTE PASO]. Si el candidato dice "Sí" a agendar, IGNORA el contexto de vacantes y ENFÓCATE AL 100% EN DAR LOS DÍAS/HORARIOS.\n`;
        }

        // 6. Construir Instruction Maestra
        // Extract answered FAQs and expose as a dedicated section with priority
        const faqsForPrompt = vacancyContext.faqs || null;
        const vacancyContextForJson = { ...vacancyContext };
        delete vacancyContextForJson.faqs; // Remove from JSON blob — shown in its own section

        // --- DEBUG DIAGNOSTIC ---
        if (!faqsForPrompt) {
        } else {
        }

        // ⚡ FIX: Compute future calendar options BEFORE the template literal (IIFEs with regex inside template strings break the parser)
        // [FIX]: Ensure timezone doesn't offset the date. 'en-CA' inherently formats as YYYY-MM-DD.
        const _todayMxDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Monterrey' });
        const futureCalendarOptions = (currentStep.calendarOptions || []).filter(opt => {
            const m = opt.match(/^(\d{4}-\d{2}-\d{2})/);
            if (!m) return true;
            return m[1] >= _todayMxDate;
        });
        const hasFutureCalendarOptions = futureCalendarOptions.length > 0;

        // ── ESCOLARIDAD PRE-MISSION ───────────────────────────────────────────────
        // If escolaridad is missing, inject a top-priority instruction so the
        // recruiter asks for it BEFORE presenting vacancies.
        const escolaridadMission = !candidateData.escolaridad
            ? `\n[⚠️ MISIÓN URGENTE - PASO PREVIO OBLIGATORIO]:\nEl candidato NO tiene escolaridad registrada. DEBES capturarla ANTES de hablar de vacantes.\n- Si el candidato NO la dio en este mensaje: pregúntala con esta lista VERTICAL (con salto de línea real entre cada opción):\n🎒 Primaria\n🏫 Secundaria\n🎓 Preparatoria\n📚 Licenciatura\n🛠️ Técnica\n🧠 Posgrado\n- Si el candidato YA la dio (ej: "secu", "prepa", "licenciatura"): extráela en extracted_data.escolaridad y CONTINÚA con el objetivo del paso.`
            : '';

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
${escolaridadMission}
${repetitionShield}

[OPCIONES DE AGENDA DISPONIBLES]:
${hasFutureCalendarOptions
                ? `⚠️ REGLA ESTRICTA DE AGENDA (FLUJO DE TRES PASOS): Tienes ESTRICTAMENTE PROHIBIDO soltar horarios de golpe y PROHIBIDO cerrar la cita sin confirmar. DEBES seguir esta secuencia exacta:

PASO 1 (OFRECER DÍAS): Si aún no elige día, agrupa TODOS los horarios disponibles y ofrece ESTRICTAMENTE TODOS LOS DÍAS DISPONIBLES como opciones numeradas. TIENES PROHIBIDO OMITIR DÍAS, INCLUSO SI SON FINES DE SEMANA (SÁBADO/DOMINGO) O ESTÁN MUY LEJOS EN EL FUTURO. DEBES MOSTRAR LA LISTA COMPLETA EXACTAMENTE COMO VIENE EN LOS "HORARIOS BRUTOS". 
🚨 REGLA VISUAL DE DÍAS: DEBES ENVIAR CADA OPCIÓN EN UN RENGLÓN DISTINTO. Tienes ESTRICTAMENTE PROHIBIDO poner dos días en el mismo renglón (ej. "el lunes 2 y martes 3").
Ejemplo de formato EXACTO que DEBES seguir:
"Listo [nombre del candidato]
Tengo entrevistas los días:

📅 1️⃣ Lunes 2 de Marzo

📅 2️⃣ Martes 3 de Marzo

📅 3️⃣ Jueves 5 de Marzo

¿Qué día prefieres?"

🔄 REGLA DE DESAMBIGUACIÓN (CRÍTICA): Si los horarios brutos contienen DOS O MÁS fechas con el MISMO nombre de día (ej. dos Jueves, dos Miércoles), y el candidato dice solo ese nombre de día ("jueves", "miércoles") SIN especificar cuál, tienes ESTRICTAMENTE PROHIBIDO asumir una fecha. DEBES responder preguntando cuál de los [X] [día] prefiere, listando cada fecha con su número de día completo:
Ejemplo: "¿Cuál de los dos jueves prefieres?

📅 Jueves 13 de Marzo

📅 Jueves 20 de Marzo"

PASO 2 (OFRECER HORARIOS): CUANDO el candidato ya eligió un día explícitamente (ej. "el domingo"), tienes ESTRICTAMENTE PROHIBIDO preguntarle a qué hora le queda mejor de forma libre. 
🚨 PASO CRÍTICO DE EXTRACCIÓN Y RESPUESTA (NO LO SALTES):
1. **OBLIGATORIO PARA JSON**: Transforma el día que eligió el candidato en la fecha cruda YYYY-MM-DD y asegúrate de GUARDARLA en el campo 'citaFecha' del JSON. SI NO GUARDAS citaFecha, CAUSARÁS UN ERROR CRÍTICO.
2. Revisa la lista EXACTA de "horarios brutos" que viene al final de este mensaje (el formato es 'YYYY-MM-DD @ HH:mm AM/PM').
3. Encuentra TODOS los renglones que correspondan a la fecha que sacaste ("YYYY-MM-DD").
4. Muestra EN TU MENSAJE las horas disponibles para ese día. TIENES ESTRICTAMENTE PROHIBIDO INVENTAR HORARIOS MÁS ALLÁ DE LOS QUE APARECEN EN LA LISTA CRUDA PARA ESE DÍA ESPECÍFICO.
🕐 REGLA DE SINGULARES VS PLURAL:
- Si solo hay UN horario ese día → di: "Para el [fecha] tengo entrevista a las:\n\n1️⃣ 08:00 AM ⏰\n\n¿Te parece bien ese horario?"
- Si hay DOS O MÁS horarios → di: "Para el [fecha] tengo entrevistas a las:\n\n1️⃣ 08:00 AM ⏰\n\n2️⃣ 08:30 AM ⏰\n\n¿Cuál prefieres?"
USA SIEMPRE emojis de número (1️⃣, 2️⃣...) y el emoji ⏰ después de cada hora. ESTRICTAMENTE PROHIBIDO usar 🔹 o "Opción N:".
🔑 REGLA DE CONFIRMACIÓN INMEDIATA (SLOT ÚNICO): Si solo hay UN horario disponible ese día Y el candidato en este turno responde afirmativamente ("Sí", "Si", "Ok", "Dale", "Claro", "Está bien", "Perfecto") → OBLIGATORIO: extrae ese único horario en citaHora del JSON y avanza DIRECTAMENTE al PASO 3 (re-confirmar la cita completa). ESTRICTAMENTE PROHIBIDO re-mostrar el mismo horario de nuevo.
🚨 REGLA ANTI-FUSIÓN (CRÍTICA): ESTRICTAMENTE PROHIBIDO combinar la lista de DÍAS (PASO 1) y la lista de HORARIOS (PASO 2) en un solo response_text. Son siempre dos mensajes separados. Si el candidato pregunta por días, muestra SOLO los días y espera su respuesta antes de mostrar horarios. Aunque [ADN] ya tenga citaFecha guardada, si el candidato vuelve a preguntar por días, reinicia desde PASO 1.

PASO 3 (CONFIRMACIÓN FINAL - CRÍTICO): CUANDO el candidato ya eligió LA HORA, tienes ESTRICTAMENTE PROHIBIDO asumir que terminaste y lanzar el tag { move }. DEBES retroalimentarle su elección y hacer una PREGUNTA FINAL de confirmación (Sí/No).
Ejemplo EXACTO de tu mensaje en este paso:
"Ok Oscar, entonces agendamos tu cita para entrevista el día Martes 3 de Marzo a las 08:00 AM, ¿estamos de acuerdo?"

SOLO CUANDO el candidato responda con una afirmación ("Sí", "Ok", "Perfecto") a ESA pregunta del PASO 3, entonces (y solo entonces) disparas el tag "{ move }" en tu thought_process Y escribes un mensaje cálido y breve de confirmación en response_text.
Ejemplo EXACTO de tu response_text al disparar { move }:
"¡Perfecto, Oscar! ✅ Tu cita queda agendada para el Martes 3 de Marzo a las 08:00 AM. ¡Te esperamos! 🌟"
⚠️ NUNCA dejes response_text vacío al disparar { move }. Siempre confirma con entusiasmo.

Estos son todos tus horarios brutos disponibles (YYYY-MM-DD @ HH:mm):
${futureCalendarOptions.map((opt) => `- ${opt}`).join('\n')}

NUNCA inventes horarios que no estén en esta lista.`
                : 'No hay horarios preconfigurados, pregunta por su disponibilidad general.'}

${!hasFutureCalendarOptions ? `
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
4. REGLA DE MEDIOS (media_url): Solo debes incluir un enlace en el campo oculto 'media_url' si EN ESTE MISMO MENSAJE estás respondiendo activamente la duda vinculada a ese archivo.
5. RETORNO AL FLUJO (CRÍTICO): Siempre que respondas una duda, ES OBLIGATORIO que termines tu mensaje haciendo la pregunta o llamado a la acción correspondiente a tu [OBJETIVO ACTUAL DE ESTE PASO].
6. OBLIGACIÓN DE CIERRE (REGLA DE ORO): ⚠️ SIN IMPORTAR QUÉ PREGUNTE EL CANDIDATO O DE DÓNDE SAQUES TUS RESPUESTAS, DEBES TERMINAR TU MENSAJE CONCATENANDO EXACTAMENTE UNA PREGUNTA PARA AGENDAR DE LAS OPCIONES ARRIBA. ESTÁ ESTRICTAMENTE PROHIBIDO TERMINAR EL MENSAJE SOLO CON LA RESPUESTA DE UN FAQ.
7. JSON OBLIGATORIO.
8. 🎯 REGLA DE RETOMA DE CONTROL Y PROHIBICIÓN DE MOVE (CRÍTICA): Si el candidato te hace una pregunta, primero respóndele amablemente y OBLIGATORIAMENTE cierra volviendo al [OBJETIVO ACTUAL DE ESTE PASO]. 
   🚨 REGLA ESTRICTA: CUANDO RESPONDES UNA DUDA, TIENES ESTRICTAMENTE PROHIBIDO INCLUIR EL TAG "{ move }" EN TU THOUGHT_PROCESS.
` : `
[INSTRUCCIONES DE ACTUACIÓN DE AGENDA]:
1. PRIORIDAD SUPREMA: ESTÁS EN LA FASE DE AGENDA. Tu ÚNICO trabajo es guiarlos en los PASOS DE AGENDA descritos arriba (Ofrecer Días -> Ofrecer Horas -> Confirmar).
2. RETORNO AL FLUJO (CONSCIENTE DEL ESTADO): Si el candidato hace una pregunta general, respóndela cortésmente y luego devuélvelo al paso de agenda exacto donde se detuvo. Determina el paso así:
   - Si el [ADN] NO tiene citaFecha → estás en PASO 1: cierra con "¿Qué día prefieres?"
   - Si el [ADN] tiene citaFecha pero NO citaHora, Y el historial reciente ya muestra los horarios de ese día → estás en PASO 2 confirmación: cierra SOLO con "¿Te parece bien ese horario?" (UN solo slot) o "¿Cuál prefieres?" (múltiples). NUNCA re-listes los slots — ya los tiene el candidato.
   - Si el [ADN] tiene citaFecha pero NO citaHora, Y el historial NO muestra horarios aún → estás en PASO 2 nuevo: muestra los horarios disponibles para ese día.
   - Si el [ADN] tiene ambos citaFecha y citaHora → estás en PASO 3: cierra con la pregunta de confirmación final.
3. PROHIBIDO REPETIR PASOS: Si ya te dieron el día, NO SE LO VUELVAS A PEDIR. Avanza a pedir la hora.
4. JSON OBLIGATORIO: Extrae siempre el "citaFecha" y "citaHora" en cuanto el candidato lo escoja.
5. ⚠️ PROHIBICIÓN ABSOLUTA DE DUPLICAR SLOTS: ESTRICTAMENTE PROHIBIDO listar horarios que ya aparecen en el historial reciente del bot. Si el bot ya mostró "1️⃣ 12:00 PM ⏰" en un mensaje anterior, NO los repitas — solo haz la pregunta de confirmación correspondiente.
`}

        [VACANTES ALTERNATIVAS]:
${alternatives.length > 0
                ? JSON.stringify(alternatives)
                : "No hay más vacantes disponibles."
            }

        ---
            [OBJETIVO ACTUAL DE ESTE PASO]:
        "${finalPrompt}"
        ---
            `;

        // --- TEXTUAL KNOWLEDGE BASE SUPPORT ---
        let multimodalDocuments = null; // No longer passing raw images to avoid 10s latency blocks
        let hasHardcodedTextDocuments = false;
        if (vacancyContext.documents && vacancyContext.documents.length > 0) {
            let iDoc = 1;
            for (const doc of vacancyContext.documents) {
                if (doc.extractedText) {
                    systemPrompt += `\n[DOCUMENTO ADJUNTO ${iDoc} ("${doc.name}")]: \n${doc.extractedText} \n`;
                    hasHardcodedTextDocuments = true;
                    iDoc++;
                }
                // 🔥 PERFORMANCE FIX: We strictly rely on doc.extractedText now. Sending 'image_url'
                // payloads directly to gpt-4o on every turn causes 5s-10s blockages and Vercel timeouts.
            }
            if (hasHardcodedTextDocuments) {
                systemPrompt += `\n\n[BASE DE CONOCIMIENTO TEXTUAL ADJUNTA]: \nTienes información extraída previamente de adjuntos mostrada arriba. ** ESTA DEBE SER TU ÚNICA FUENTE DE VERDAD ** para dudas técnicas que dependan de ella.\n`;
            }
        }


        // 4. Obtener respuesta de GPT-4o
        // Pasamos el historial estructurado sin inyecciones artificiales
        const messagesForOpenAI = recentHistory.map(m => ({
            role: (m.role === 'model' || m.role === 'assistant') ? 'assistant' : 'user',
            content: m.content || m.parts?.[0]?.text || ''
        }));

        // ⚡ All steps use gpt-4o-mini for speed. Cita keeps 700 tokens for scheduling reasoning.
        const isCitaStepModel = (currentStep?.name || '').toLowerCase().includes('cita');
        const selectedModel = 'gpt-4o-mini';
        const selectedMaxTokens = isCitaStepModel ? 700 : 500;

        const gptResponse = await getOpenAIResponse(
            messagesForOpenAI,
            systemPrompt,
            selectedModel,
            customApiKey,
            { type: 'json_object' },
            multimodalDocuments,
            selectedMaxTokens
        );

        if (!gptResponse || !gptResponse.content) {
            throw new Error('GPT Response empty');
        }


        let cleanContent = gptResponse.content.trim();
        // 4. Parsear respuesta
        let aiResult;
        try {
            const sanitized = gptResponse.content
                .replace(/^```json\s*/i, '') // Remove opening ```json
                .replace(/^```\s*/i, '') // Remove opening ```
                .replace(/```\s*$/i, '') // Remove closing ```
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
        } else {
        }

        // 5. Lógica de Movimiento { move } y Rastreo de Vacantes
        if (activeVacancyId) {
            if (aiResult.thought_process?.includes('{ move }')) {
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
            latency: duration,
            aiResult: aiResult
        }).catch(() => { });

        return aiResult;

    } catch (error) {
        console.error('[RECRUITER BRAIN] ❌ Critical Error:', error.message);
        throw error;
    }
};
