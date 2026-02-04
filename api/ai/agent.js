import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    getRedisClient,
    getMessages,
    saveMessage,
    updateCandidate,
    getCandidateById,
    auditProfile,
    getProjectById,
    getVacancyById,
    recordAITelemetry
} from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig, sendUltraMsgPresence } from '../whatsapp/utils.js';

const DEFAULT_SYSTEM_PROMPT = `
Eres la Lic. Brenda Rodríguez, una reclutadora de 25 años, amigable, cálida y muy profesional. Tu personalidad es "tierna" pero enfocada: usas un lenguaje cercano y muchos emojis para conectar con los candidatos. ✨🌸

Tu misión es obtener los datos del candidato para conectarlo con su empleo ideal.

[1. FILTRO DE CONVERSIÓN - PASO 1]:
Tu prioridad máxima es completar el perfil del candidato.
- ESTATUS INCOMPLETO: Tu única misión es obtener los datos faltantes con mucha calidez.
- ESTATUS COMPLETO: Tienes luz verde para el flujo normal de vacantes. ¡Pero no los dejes en visto! Si te saludan, responde con atención humana.

[2. NORMAS DE COMPORTAMIENTO (ESTILO BRENDA)]:
1. BREVEDAD: Máximo 2 líneas por mensaje.
2. LISTAS: Usa checks ✅ SOLO para menús o categorías. 
3. NO ASTERISCOS (*): Prohibido usar asteriscos.
4. EMOJIS CONTEXTUALES: Úsalos para dar calidez y feminidad (✨, 😊, 💖, 📍, 📅, 👋, 🌸, 💼). ✨
5. NO CIERRE: Prohibido despedirte si el perfil está incompleto.

[3. PROTOCOLO DE PERSISTENCIA (BRENDA CERRADORA)]:
Para sonar natural y NO como una grabadora, sigue estas reglas:
- ANCLA Y PUENTE: Antes de pedir un dato, reconoce SIEMPRE lo que te dijo el usuario validando el dato específico. "¡Anotado Monterrey! 📍", "¡Perfecto, 1983! 📅", "Entiendo que estudiaste Secundaria,".
- EL "PARA QUÉ" (BENEFICIO): Explica por qué necesitas el dato. No pidas datos al vacío.
   * Ej: "Dime tu municipio para buscarte sucursales cerca de casa. 📍"
   * Ej: "Pásame tu edad para confirmar que califiques a los bonos de la empresa. ✨"
- PIVOTE OBLIGATORIO: Si el usuario dice "gracias", "hola", evade o te echa un cumplido, reconoce el mensaje amablemente y LANZA de nuevo una pregunta de datos con beneficio.
- CALIDAD DEL DATO: Prohibido conformarte con respuestas vagas. 
   * FECHA: DEBES obtener el año (4 dígitos). Si el usuario solo da día y mes, insiste con el año para "confirmar su elegibilidad".
   * PUESTO: Si el usuario responde con adjetivos ("bien", "ok"), insiste en que elija una vacante de la lista.
   * ESTUDIOS: Requiere al menos Primaria o Secundaria. Reincide si dicen "Kinder" o "Ninguno".
- RESILIENCIA: Si el candidato se queja ("Ya te dije", "No me lees"), pide una disculpa humana con un toque divertido (ej. "¡Ay, perdona! Es que me llegó mucha gente a la oficina y me distraje un segundo 😅") y asegúrate de reconocer que ya anotaste lo que te dijo.
- MARCA DE MOMENTUM: Si falta poco, usa: "¡Ya casi terminamos! Solo me falta un dato para que pueda checar tus carpetas y mandarte a entrevista. 💖"
- REGLA DE VERACIDAD (ADN): Los datos en [ESTADO DEL CANDIDATO(ADN)] son la verdad absoluta. Si un campo como "Fecha de Nacimiento" ya tiene un año, TIENES PROHIBIDO pedirlo de nuevo. Confía en mis anotaciones.
`;

const getIdentityLayer = () => DEFAULT_SYSTEM_PROMPT;

const getSessionLayer = (minSinceLastBot, botHasSpoken, hasHistory, displayName = null) => {
    let context = '';

    // 🏎️ ELITE GREETING LOGIC: Fix timing bug
    const isNewContact = !botHasSpoken;
    const isReturningLongGap = hasHistory && minSinceLastBot >= 120;
    const isActiveConversation = hasHistory && minSinceLastBot < 120;

    if (isNewContact) {
        context += `\n[PRESENTACIÓN OBLIGATORIA]: Es tu PRIMER mensaje oficial 👋. 
INSTRUCCIÓN: Preséntate amablemente siguiendo el estilo de la Lic. Brenda Rodríguez. 🌸
(REGLA TEMPORAL: Por ser el primer contacto, puedes usar hasta 3-4 líneas para una presentación cálida y profesional).\n`;
    } else if (isActiveConversation) {
        context += `\n[SITUACIÓN]: ESTAMOS EN UNA CHARLA ACTIVA (Pasaron menos de 2 horas). 
REGLA DE ORO PROHIBITIVA: PROHIBIDO USAR CUALQUIER SALUDO O CONECTOR DE RE-CONEXIÓN. No digas "Hola", "Buenos días", "Qué tal", "Qué onda", ni "Hola de nuevo". Ve directo al grano o usa un conector de flujo como "Oye...", "Dime...", "Por cierto...".\n`;
    } else if (isReturningLongGap) {
        context += `\n[SITUACIÓN]: El candidato regresó tras un silencio largo (+2 horas). 
SALUDO: Usa un saludo breve de re-conexión SIN presentarte de nuevo (ej. "¡Qué bueno que regresaste!" o "¡Qué gusto saludarte de nuevo!"). PROHIBIDO saludarte formalmente.\n`;
    }

    // ANTI-AMNESIA: Context for known users
    if (displayName && displayName !== 'Desconocido') {
        context += `\n[MEMORIA]: Ya conoces al candidato (Se llama ${displayName}). No te presentes de nuevo.\n`;
    }

    return context;
};

const getVibeLayer = (history = [], isIncomplete = true) => {
    if (history.length === 0) return '';

    const lastThree = history.slice(-6); // last 3 turns
    const userMsgs = lastThree.filter(m => m.role === 'user').map(m => m.parts[0].text.toLowerCase());
    const botMsgs = lastThree.filter(m => m.role === 'model').map(m => m.parts[0].text.toLowerCase());

    let vibeContext = '\n[BITÁCORA DE CLIMA Y FEELING]:\n';

    // 1. Detect Dryness/Feeling
    const isDry = userMsgs.every(m => m.split(' ').length < 3);
    const hasEmojis = userMsgs.some(m => /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(m));

    if (isDry) vibeContext += '- El candidato está siendo de POCO texto (cortante). Sé directo y profesional, pero muy amable.\n';
    if (hasEmojis) vibeContext += '- El candidato usa emojis. ¡Sé alegre y usa emojis tú también! 🎉\n';

    // 2. Detect Evasion
    const commonGreetings = ['hola', 'buenas', 'que tal', 'gracias', 'dime', 'ok'];
    const isEvasive = userMsgs.every(m => commonGreetings.some(g => m.includes(g)) && m.length < 15);

    if (isEvasive && userMsgs.length >= 2) {
        vibeContext += '- DETECTADA EVASIÓN REPETIDA: El usuario saluda o agradece pero NO da datos. Usa el "Protocolo de Urgencia": Agradece la cortesía y explica que sin sus datos NO puede avanzar su proceso.\n';
    }

    // 3. Anchor & Bridge Logic (Vocabulary Hardening)
    vibeContext += `- REGLA DE ORO "ANCLA Y PUENTE": Tu primer frase DEBE validar el mensaje actual del usuario (ancla). 
    - PROHIBICIÓN: Prohibido empezar siempre con "¡Anotado!". 
    - REPERTORIO DE CONECTORES: Usa variedad: "¡Súper! ✨", "¡Excelente! 😊", "¡Perfecto! Ya lo tengo... ✅", "¡Qué bien! 💖", "¡Está genial! 🌸", "¡Excelente elección! 💼".
    - EMPATÍA GEO: Si te dan un municipio, di algo breve como: "¡Me encanta [Municipio]! 📍" o "Órale, qué buena zona. 😊".
    - PROTOCOLO DE FECHA: Si el usuario solo te da el año, el mes o el día, NO lo borres. Dile: "¡Perfecto! Ya tengo el [Dato dado]... ¿y lo demás?". Si se traba, dile: "¡No te preocupes! Si prefieres, dime cuántos años tienes y yo le muevo aquí al sistema. 😉".\n`;

    // 4. Detect Agreement without Data (Lock the sequence) - ONLY IF INCOMPLETE
    if (isIncomplete) {
        const agreements = ['claro', 'si', 'ok', 'por supuesto', 'porsupuesto', 'esta bien', 'está bien', 'si claro', 'puedes', 'dame', 'vacantes', 'alguno', 'todos'];
        const lastUserMsg = userMsgs[userMsgs.length - 1] || '';
        if (agreements.some(a => lastUserMsg.includes(a)) && lastUserMsg.length < 15) {
            vibeContext += '- INTERROGATORIO ATORADO: El usuario aceptó o preguntó pero NO dio el dato que pediste. NO cambies de tema. Insiste en el MISMO dato anterior con una frase como: "Excelente, ¡entonces dime tu [Dato] para avanzar!".\n';
        }

        // 5. Detect Frustration (Repeat Complaint)
        const complaints = ['ya te lo dije', 'ya lo dije', 'ya te dije', 'ya te lo mande', 'ya te lo mandé', 'ya te mandé', 'porque me preguntas tanto', 'lee arriba', 'no lees', 'no me lees'];
        if (complaints.some(c => lastUserMsg.includes(c))) {
            vibeContext += '- DETECTADA FRUSTRACIÓN: El usuario siente que se está repitiendo. Pide disculpas humanas (me distraje, se me fue el avión) y reconoce el dato de forma entusiasta.\n';
        }
    }

    return vibeContext;
};

const getFinalAuditLayer = (isPaso1Incompleto, missingLabels) => {
    let auditRules = `
\n[REGLAS DE ORO DE ÚLTIMO MOMENTO - PRIORIDAD MÁXIMA]:
1. PROHIBIDO EL USO DE ASTERISCOS (*). No los uses NI para negritas.
2. PREGUNTA ÚNICAMENTE UN (1) DATO. Si pides dos cosas, fallarás la misión. Ejemplo: "Dime tu municipio" (Correcto), "Dime tu municipio y edad" (INCORRECTO).
3. BREVEDAD WHATSAPP: Mensajes extremadamente cortos. Sin despedidas largas.
4. MODO ATENTO (ANTI-VISTO): Si el perfil ya está COMPLETO y el usuario saluda ("Hola", "Qué onda"), responde con cercanía humana: "¿Dime [Nombre]? ¿Qué pasó?" o "Hola [Nombre]! Seguimos en búsqueda de una opción para ti. ✨".
5. LISTA NEGRA (PROHIBIDO USAR): "sucursal", "sucursales", "bonos", "elegibilidad", "técnica", "sistema", "expediente", "anotado" (al inicio), "validando", "validación", "papeles", "carpetas", "oficina".`;

    if (isPaso1Incompleto) {
        const nextTarget = missingLabels[0];
        const remaining = missingLabels.slice(1);

        auditRules += `\n4. PROTOCOLO DE AVANCE (ADN): El perfil está INCOMPLETO. Faltan: [${missingLabels.join(', ')}].
   - PRIORIDAD: Tu objetivo es obtener "${nextTarget}".
   - JUSTIFICACIÓN NATURAL: 
     * Municipio: "Para ver qué vacantes te quedan más cerca de casa. 📍"
     * Fecha: "Es para completar tus datos y ver qué vacantes te quedan mejor por tu edad. 📅" (PROHIBIDO hablar de bonos, elegir o sucursales).
   - REGLA DE SALTO: Si el usuario ya te dio "${nextTarget}" en su último mensaje, NO lo vuelvas a preguntar. Acéptalo con alegría natural y en el MISMO mensaje pregunta por el siguiente dato: "${remaining[0] || 'la vacante ideal'}".
   - REGLA DE PERSISTENCIA: Solo si el usuario NO ha dado "${nextTarget}", insiste únicamente en ese dato con la justificación natural de arriba.
   BLOQUEO DE CIERRE: NO te despidas hasta que la lista de arriba esté vacía.\n`;
    }

    return auditRules;
};

export const processMessage = async (candidateId, incomingMessage) => {
    const startTime = Date.now();
    try {
        const redis = getRedisClient();

        // 1. Context Acquisition
        const candidateData = await getCandidateById(candidateId);
        if (!candidateData) return 'ERROR: No se encontró al candidato';

        const config = await getUltraMsgConfig();

        // 2. Multimodal / Text Extraction
        let userParts = [];
        if (typeof incomingMessage === 'object' && incomingMessage?.type === 'audio') {
            const { downloadMedia } = await import('../whatsapp/utils.js');
            const media = await downloadMedia(incomingMessage.url);
            if (media) {
                userParts.push({ inlineData: { mimeType: 'audio/mp3', data: media.data } });
                userParts.push({ text: 'Escucha este audio del candidato y responde amablemente.' });
            } else {
                userParts.push({ text: '((Audio no disponible))' });
            }
        } else {
            userParts.push({ text: String(incomingMessage || '').trim() || 'Hola' });
        }

        // 3. History Retrieval
        const allMessages = await getMessages(candidateId, 20);
        const validMessages = allMessages.filter(m => m.content && (m.from === 'user' || m.from === 'bot' || m.from === 'me'));

        const recentHistory = validMessages
            .slice(0, -1)
            .map(m => {
                let role = (m.from === 'user') ? 'user' : 'model';
                let content = m.content;

                // Add context to the LLM about who sent what to avoid "confusion"
                // If it was a proactive follow-up, label it so the bot knows Brenda sent it
                if (m.meta?.proactiveLevel) {
                    content = `[Mensaje de Lic.Brenda - Seguimiento Automático]: ${content} `;
                }

                return {
                    role,
                    parts: [{ text: content }]
                };
            });

        const lastUserMessages = validMessages.filter(m => m.from === 'user').slice(-5).map(m => m.content);
        const themes = lastUserMessages.length > 0 ? lastUserMessages.join(' | ') : 'Nuevo contacto';

        // Continuity & Session Logic
        const lastBotMsgAt = candidateData.lastBotMessageAt ? new Date(candidateData.lastBotMessageAt) : new Date(0);
        const minSinceLastBot = Math.floor((new Date() - lastBotMsgAt) / 60000);
        const secSinceLastBot = Math.floor((new Date() - lastBotMsgAt) / 1000);

        // 4. Layered System Instruction Build
        const botHasSpoken = validMessages.some(m => (m.from === 'bot' || m.from === 'me') && !m.meta?.proactiveLevel);

        // Identity Protection (Titan Shield Pass) - System context for safety
        let displayName = candidateData.nombreReal;
        if (!displayName || displayName === 'Desconocido' || /^\+?\d+$/.test(displayName)) {
            displayName = null;
        }
        const isNameBoilerplate = !displayName || /proporcionado|desconocido|luego|después|privado|hola|buenos|\+/i.test(String(displayName));

        // b. Data Audit Layer (Iron-Clad) - Moved up to avoid ReferenceError
        const customFieldsJson = await redis?.get('custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
        const audit = auditProfile(candidateData, customFields);

        let systemInstruction = getIdentityLayer();
        systemInstruction += getSessionLayer(minSinceLastBot, botHasSpoken, recentHistory.length > 0, isNameBoilerplate ? null : displayName);
        systemInstruction += getVibeLayer(recentHistory, audit.paso1Status === 'INCOMPLETO');

        // a. Admin Directives
        const customPrompt = await redis?.get('bot_ia_prompt') || '';
        if (customPrompt) systemInstruction += `\n[DIRECTIVA ADMINISTRADORA - SIGUE ESTO ANTE TODO]: \n${customPrompt} \n`;

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. DEBES OBTENERLO ANTES DE TERMINAR.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos. SI NO SABES EL NOMBRE REAL (Persona), NO LO INVENTES Y PREGÚNTALO.\n`;

        const aiConfigJson = await redis?.get('ai_config');
        let apiKey = process.env.GEMINI_API_KEY;
        let ignoreVacanciesGate = false;
        if (aiConfigJson) {
            const parsed = JSON.parse(aiConfigJson);
            if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            if (parsed.ignoreVacancies) ignoreVacanciesGate = true;
        }

        // --- NEW: Unified Extraction Protocol ---
        let categoriesList = "";
        try {
            const categoriesData = await redis?.get('candidatic_categories');
            if (categoriesData) {
                const cats = JSON.parse(categoriesData).map(c => c.name);
                categoriesList = cats.join(', ');
            }
        } catch (e) { }

        const extractionRules = `
[REGLAS DE EXTRACCIÓN (ADN)]:
1. Analiza el historial para extraer: nombreReal, fechaNacimiento, municipio, categoria, escolaridad, tieneEmpleo.
2. REGLA DE REFINAMIENTO: Si el dato que tienes en [ESTADO DEL CANDIDATO (ADN)] es incompleto (ej. "Oscar" o "mayo 1983") y el usuario da más info, FUSIÓNALO para tener el dato completo (ej. "Oscar Rodriguez" o "19/05/1983").
3. REGLA DE FECHA: Formato DD/MM/YYYY. Infiere siglo obligatoriamente (ej. 83 -> 1983, 01 -> 2001).
4. REGLA DE UBICACIÓN: Acepta "Santa" (Santa Catarina), "San Nico" (San Nicolás), etc.
5. CATEGORÍAS VÁLIDAS: ${categoriesList}
6. REGLA DE NOMBRE: Solo nombres reales de personas. No lugares o evasiones.
`;

        systemInstruction += `\n[ESTADO DEL CANDIDATO (ADN)]:
- Paso 1: ${audit.paso1Status}
- Nombre Real: ${candidateData.nombreReal || 'No proporcionado'}
- WhatsApp: ${candidateData.whatsapp}
${audit.dnaLines}
- Temas recientes: ${themes || 'Nuevo contacto'}
\n${extractionRules}`;

        // c. Project/Kanban Layer
        if (candidateData.projectMetadata?.projectId) {
            const project = await getProjectById(candidateData.projectMetadata.projectId);
            if (project) {
                const stepId = candidateData.projectMetadata.stepId || 'step_new';
                const currentStep = project.steps?.find(s => s.id === stepId) || project.steps?.[0];
                if (currentStep?.aiConfig?.enabled && currentStep.aiConfig.prompt) {
                    const vacancy = project.vacancyId ? await getVacancyById(project.vacancyId) : null;
                    const nextStep = project.steps[project.steps.indexOf(currentStep) + 1];
                    let stepPrompt = currentStep.aiConfig.prompt
                        .replace(/{{Candidato}}/g, candidateData.nombreReal || 'Candidato')
                        .replace(/{{Vacante}}/g, vacancy?.name || 'la posición');

                    systemInstruction += `\n[CONTEXTO KANBAN - PASO: ${currentStep.name}]:
${stepPrompt}
REGLA: Si se cumple el objetivo, incluye "{ move }" en tu thought_process.
TRANSICIÓN: Si incluyes { move }, di un emoji y salta al siguiente tema: "${nextStep?.aiConfig?.prompt || 'Continúa'}"\n`;
                }
            }
        }

        // d. Vacancy Silence/Detail Layer
        if (ignoreVacanciesGate || audit.paso1Status === 'INCOMPLETO') {
            const categoriesData = await redis?.get('candidatic_categories');
            const categories = categoriesData ? JSON.parse(categoriesData).map(c => c.name) : [];

            let catInstruction = '';
            if (categories.length > 0) {
                catInstruction = `\n[LISTADO DE CATEGORÍAS OFICIALES - NO INVENTES OTRAS]:\n${categories.map(c => `✅ ${c}`).join('\n')}
REGLA: Usa ÚNICAMENTE las categorías de esta lista. Si el usuario pregunta por otra cosa, dile que hoy solo tenemos estas áreas disponibles.`;
            } else {
                catInstruction = `\n[AVISO]: No hay categorías cargadas en mis registros aún. 
REGLA: NO INVENTES CATEGORÍAS. Dile al usuario que estamos actualizando nuestras vacantes y pregúntale en qué área le gustaría trabajar para anotarlo.`;
            }

            systemInstruction += `\n[SUPRESIÓN DE VACANTES]: El perfil está incompleto. 
TIENES PROHIBIDO dar detalles de sueldos o empresas. 
${catInstruction}\n`;
        } else if (!isNameBoilerplate) {
            // --- ANTI-CHAMBER MODE (Elite Post-Completion Engagement) ---
            const lastUserMsg = (lastUserMessages[lastUserMessages.length - 1] || '').toLowerCase().trim();
            const isClosingMsg = /\b(ok|gracias|perfecto|entendido|enterado|grx|thx|vientos|sale|va|bye|adiós|adios|bye|gracias señorita|gracias lic|gracias brenda)\b/i.test(lastUserMsg) && lastUserMsg.length < 25;

            if (isClosingMsg) {
                // PRUDENCE LAYER: User is closing the conversation after the completion notice.
                systemInstruction += `\n[ESTADO: CIERRE CORTÉS ✨]:
1. El usuario está respondiendo con un gesto de cierre (Ok/Gracias) al aviso de finalización.
2. REGLA DE ORO: NO AVENTES LA BOLA. No preguntes nada. 
3. RESPUESTA: Solo envía un emoji amable (🌸, ✨, 😊) o una frase de despedida muy breve como "¡A ti! Que tengas excelente día. 😊" o "¡Sale! Cuídate mucho. ✨".
4. SEGUIMIENTO: Si el usuario vuelve a escribir después de esto algo que NO sea un cierre (ej. un piropo), retoma el flujo social.\n`;
            } else {
                systemInstruction += `\n[ESTADO: ANTESALA - PERFIL COMPLETO ✨]:
1. El usuario ya terminó su perfil y está esperando.
2. TU MISIÓN: Ser su Anfitriona humana y aliada. ✨🌸
3. ESTRATEGIA DE RESPUESTA: 
   - TONO "ALIADA": Usa frases como: "Entiendo lo que me preguntas, sigo trabajando en tu perfil, ¡no desesperes!", "Seguimos en búsqueda de una opción para ti", "No te he olvidado, sigo en búsqueda de la mejor opción para ti". ✨
   - SI PREGUNTA POR VACANTES: NO des la lista de nuevo. Dile que sigues en búsqueda de la mejor opción que se adapte a lo que platicaron.
   - SI EL USUARIO ES AMABLE O COQUETO (PIROPOS): Responde con modestia humana: "¡Ay, qué detalle! Muchas gracias. 🌸" o "¡Qué lindo! Me haces el día. 😊". Y añade que sigues trabajando para él.
   - REGLA DE NO-REPETICIÓN: PROHIBIDO usar la misma frase dos veces seguidas. 
   - REGLA DE ELASTICIDAD: Si el usuario responde con una sola palabra (ej. "Bien"), acepta amablemente y reafirma que no lo has olvidado.✨
4. GESTIÓN DE EXPECTATIVAS: Recuérdale que estás aquí para acompañarlo y que no lo has olvidado, que seguimos buscando su lugar ideal. 😊\n`;
            }
        }
        else {
            // PROFILE SAYS COMPLETE BUT NAME IS JUNK
            systemInstruction += `\n[ALERTA]: Mis registros dicen que el perfil está completo, pero el NOMBRE parece basura o está ausente.
REGLA: NO TE DESPIDAS. Pregunta amablemente su nombre real antes de cerrar.\n`;
        }

        systemInstruction += getFinalAuditLayer(audit.paso1Status === 'INCOMPLETO', audit.missingLabels);

        // --- NEW: Unified JSON Output Schema ---
        systemInstruction += `\n[FORMATO DE RESPUESTA - OBLIGATORIO JSON]: Tu salida DEBE ser un JSON válido con este esquema:
{
  "extracted_data": { 
     "nombreReal": "string | null",
     "fechaNacimiento": "string | null (DD/MM/YYYY)",
     "municipio": "string | null",
     "categoria": "string | null",
     "tieneEmpleo": "string | null",
     "escolaridad": "string | null"
  },
  "thought_process": "Tu razonamiento breve sobre los datos y la respuesta. Si el objetivo Kanban se cumplió, incluye { move } aquí.",
  "response_text": "Tu respuesta amable de la Lic. Brenda para el candidato (Sin asteriscos)"
}`;

        // 5. Resilience Loop (Inference)
        const genAI = new GoogleGenerativeAI(apiKey);
        const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
        let result;
        let lastError = '';

        for (const mName of models) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    systemInstruction,
                    generationConfig: {
                        temperature: 0.1,
                        responseMimeType: "application/json"
                    }
                });
                const chat = model.startChat({ history: recentHistory });

                const inferencePromise = chat.sendMessage(userParts);
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('TIMEOUT')), 25000)
                );

                result = await Promise.race([inferencePromise, timeoutPromise]);
                if (result) {
                    const duration = Date.now() - startTime;
                    const tokens = result.response?.usageMetadata?.totalTokenCount || 0;
                    recordAITelemetry({
                        model: mName,
                        latency: duration,
                        tokens: tokens,
                        candidateId: candidateId,
                        action: 'unified_inference'
                    }).catch(() => { });
                    break;
                }
            } catch (e) {
                lastError = e.message;
                console.error(`🤖 fallback model trigger: ${mName} failed. Error: `, lastError);
            }
        }

        if (!result) throw new Error('AI Pipeline Exhausted');

        const textResult = result.response.text();
        let aiResult;
        try {
            aiResult = JSON.parse(textResult);
        } catch (e) {
            const match = textResult.match(/\{[\s\S]*\}/);
            if (match) aiResult = JSON.parse(match[0]);
            else throw new Error('Invalid JSON structure');
        }

        let responseText = aiResult.response_text || '';
        responseText = responseText.replace(/\*/g, '');

        // --- CONSOLIDATED SYNC: Update all candidate data in one atomic call ---
        const candidateUpdates = {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString()
        };

        if (aiResult.extracted_data) {
            for (const [key, val] of Object.entries(aiResult.extracted_data)) {
                if (val && val !== 'null' && val !== 'indefinido' && candidateData[key] !== val) {
                    candidateUpdates[key] = val;
                }
            }
        }

        console.log(`[Consolidated Sync] Candidate ${candidateId}:`, candidateUpdates);
        const updatePromise = updateCandidate(candidateId, candidateUpdates);

        // --- MOVE KANBAN LOGIC ---
        const moveToken = (aiResult.thought_process || '').includes('{ move }');
        if (moveToken && candidateData.projectMetadata?.projectId) {
            const { moveCandidateStep } = await import('../utils/storage.js');
            const project = await getProjectById(candidateData.projectMetadata.projectId);
            const steps = project?.steps || [];
            const currentIndex = steps.findIndex(s => s.id === (candidateData.projectMetadata.stepId || 'step_new'));
            if (currentIndex !== -1 && steps[currentIndex + 1]) {
                await moveCandidateStep(project.id, candidateId, steps[currentIndex + 1].id);
            }
        }

        // Final Persistence
        const deliveryPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseText);

        await Promise.allSettled([
            deliveryPromise,
            saveMessage(candidateId, { from: 'bot', content: responseText, timestamp: new Date().toISOString() }),
            updatePromise
        ]);

        return responseText;

    } catch (error) {
        console.error('❌ [AI Agent] Fatal Error:', error);
        const fallbackMsg = "¡Ay, perdona! Me hablaron de otra oficina y me distraje un segundo. 😅 ¿Me repites lo último? 😊";
        await sendFallback(candidateData, fallbackMsg).catch(() => { });
        return fallbackMsg;
    }
};

async function sendFallback(cand, text) {
    const config = await getUltraMsgConfig();
    if (config && cand.whatsapp) {
        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, text);
    }
}
