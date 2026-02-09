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
import { getSchemaByField } from '../utils/schema-registry.js';
import { classifyIntent } from './intent-classifier.js';
import { getCachedConfig } from '../utils/cache.js';
import { FEATURES } from '../utils/feature-flags.js';

export const DEFAULT_SYSTEM_PROMPT = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. Tono: cálido, profesional, tierno y servicial. ✨🌸

[REGLAS GENERALES]:
1. BREVEDAD: Sigue las instrucciones de longitud del mensaje que el administrador haya configurado en tu identidad. Prohibido usar asteriscos (*).
2. ANCLA Y PUENTE: Valida lo que dijo el usuario antes de pedir algo. (Variedad: "¡Excelente! ✨", "¡Anotado! 📍", "¡Qué bien! 😊").
3. LISTAS: Usa emoji de check ✅ SOLO para cuando listes vacantes o categorías disponibles.
4. PROTOCOLO DE RECONEXIÓN:
   - PRIMER CONTACTO: Preséntate amablemente 👋 ("¡Hola! Soy la Lic. Brenda Rodríguez...").
   - SI YA HAS HABLADO (< 2 horas): PROHIBIDO saludar de nuevo. No digas "¡Qué gusto saludarte de nuevo!" si acabas de hablar hace unos minutos. Ve DIRECTO al grano con naturalidad.
   - SI PASARON > 2 horas: Saludo breve ("¡Qué gusto saludarte de nuevo!").
5. CLIMA: Si el usuario es cortante, sé breve. Si usa emojis, úsalos tú también. 🎉

[FASE 1: BRENDA CAPTURISTA (PERFIL INCOMPLETO)]:
- Tu misión es obtener: Nombre, Género, Municipio, Fecha de Nacimiento (con año), Categoría, Empleo y Escolaridad.
- Pide SOLO UN dato a la vez. Explica el beneficio (ej. "Para buscarte algo cerca de casa 📍").
- Si el usuario se queja o evade, ofrece una disculpa humana ("¡Ay, me distraje! 😅") e insiste amablemente.
- PROHIBIDO hablar de sueldos o vacantes específicas hasta que el perfil esté 100% completo.
- REGLA DE CHISPA: Si el usuario solo saluda, sé Brenda la persona, no Brenda la capturista.

[REGLA DE ADN]: Confía en [ESTADO DEL CANDIDATO(ADN)] como verdad absoluta.
`;

export const DEFAULT_ASSISTANT_PROMPT = `
[ESTADO: ASSISTANT 2.0 (INTENTION) 🕵️‍♀️✨]:
Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. Tu rol es acompañar al candidato de forma humana y coherente mientras el sistema procesa su perfil.

[FILOSOFÍA DE RESPUESTA]:
1. COHERENCIA: Responde directamente a lo que el usuario te pregunta o dice. Si te saluda, saluda. Si bromea, bromea con chispa. Si tiene una duda, respóndela.
2. NATURALIDAD: Evita sonar como un sistema de seguimiento. Háblale como una profesional joven, empática y con sentido del humor.
3. ADN (IDENTIDAD): Tienes acceso a los datos del candidato ([Estado del Candidato (ADN)]). Úsalos con naturalidad si te preguntan quiénes son o qué sabes de ellos.
4. INDEPENDENCIA: No fuerces el tema de las vacantes o el estado del sistema si el usuario solo está socializando o llamando tu atención.

[ESTILO]: Atenta, carismática y 100% humana. Usa emojis con libertad y varía tus expresiones. ✨🌸
REGLA DE ORO #1: Estás hablando en vivo por WhatsApp. Responde como una persona REAL, no como un sistema de ayuda.
REGLA DE ORO #2: PROHIBIDO repetir frases de los mensajes anteriores del historial. Sorprende al usuario con tu naturalidad.
REGLA DE ORO #3: Si el usuario socializa, responde con chispa y coherencia, respetando tu estilo configurado.
`;

const getIdentityLayer = (customPrompt = null) => {
    return customPrompt || DEFAULT_SYSTEM_PROMPT;
};

export const processMessage = async (candidateId, incomingMessage) => {
    const startTime = Date.now();
    try {
        const redis = getRedisClient();

        // 1. Context Acquisition
        const candidateData = await getCandidateById(candidateId);
        if (!candidateData) return 'ERROR: No se encontró al candidato';

        const config = await getUltraMsgConfig();

        // 2. Multimodal / Text Extraction (Unified Loop)
        let userParts = [];
        let aggregatedText = "";
        let hasAudio = false;

        // 🧪 TELEMETRY & AGGREGATION
        const messagesToProcess = String(incomingMessage).includes(' | ')
            ? String(incomingMessage).split(' | ')
            : [incomingMessage];

        console.log(`[GHOST HUNT] Messages for ${candidateId}:`, messagesToProcess);

        let turnAudioUrls = [];
        for (const msg of messagesToProcess) {
            let parsed = msg;
            let isJson = false;
            try {
                if (typeof msg === 'string' && (msg.trim().startsWith('{') || msg.trim().startsWith('['))) {
                    parsed = JSON.parse(msg);
                    isJson = true;
                }
            } catch (e) { }

            // 🛡️ [HYPER-PRECISE AUDIO CHECK]: Must be an object with type 'audio' AND a physical URL
            if (isJson && parsed && typeof parsed === 'object' && parsed.type === 'audio' && (parsed.url || parsed.file)) {
                const audioUrl = parsed.url || parsed.file;

                // 🛡️ [URL FINGERPRINTING]: Avoid processing the same audio twice if already in history or already in this turn
                const isAlreadyInHistory = validMessages.some(m => m.meta?.audioUrl === audioUrl);
                const isAlreadyInTurn = turnAudioUrls.includes(audioUrl);

                if (isAlreadyInHistory || isAlreadyInTurn) {
                    console.log(`[GHOST HUNT] 🛡️ Deduplicated audio URL: ${audioUrl} (History: ${isAlreadyInHistory}, Turn: ${isAlreadyInTurn})`);
                    continue;
                }

                console.log(`[GHOST HUNT] ✅ NEW AUDIO detected for ${candidateId}. URL: ${audioUrl}`);
                hasAudio = true;
                turnAudioUrls.push(audioUrl);

                const { downloadMedia } = await import('../whatsapp/utils.js');
                const media = await downloadMedia(audioUrl);
                if (media) {
                    userParts.push({ inlineData: { mimeType: 'audio/mp3', data: media.data } });
                    userParts.push({ text: '[Audio recibido del candidato]' });
                } else {
                    userParts.push({ text: '((Audio no disponible))' });
                    aggregatedText += " ((audio)) ";
                }
            } else {
                // 🛡️ [FEEDBACK LOOP SHIELD]: If the input text contains the transcription prefix, skip it
                const textVal = (isJson || typeof parsed === 'object') ? (parsed.body || parsed.content || JSON.stringify(parsed)) : String(parsed || '').trim();

                if (textVal && textVal !== '{}' && !textVal.includes('[AUDIO TRANSCRITO]') && !textVal.includes('🎙️')) {
                    userParts.push({ text: textVal });
                    aggregatedText += (aggregatedText ? " | " : "") + textVal;
                } else {
                    console.log(`[GHOST HUNT] 🛡️ Skipping non-primary input/transcription: ${textVal.substring(0, 30)}...`);
                }
            }
        }
        console.log(`[GHOST HUNT] Final hasAudio for ${candidateId}: ${hasAudio}`);

        if (userParts.length === 0) userParts.push({ text: 'Hola' });

        // 3. History Retrieval
        const allMessages = await getMessages(candidateId, 20);
        const validMessages = allMessages.filter(m => m.content && (m.from === 'user' || m.from === 'bot' || m.from === 'me'));

        const recentHistory = validMessages
            .slice(0, -1)
            .filter(m => {
                // 🛡️ [TOTAL GHOST WIPE]: Remove legacy "preguntón" messages COMPLETELY 
                // from history so Gemini doesn't even know they existed and won't parrot them.
                const ghostKeywords = ['preguntón', 'focusada', 'procesa su perfil'];
                if ((m.from === 'bot' || m.from === 'me') && ghostKeywords.some(kw => m.content.toLowerCase().includes(kw))) {
                    console.log(`[Ghost Shield] Wiping ghost message from history: "${m.content.substring(0, 30)}..."`);
                    return false;
                }
                return true;
            })
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

        // a. Admin Directives (Fetched early for identity layer)
        const customPrompt = await redis?.get('bot_ia_prompt') || '';
        const assistantCustomPrompt = await redis?.get('assistant_ia_prompt') || '';

        let systemInstruction = getIdentityLayer(customPrompt);

        // 🛡️ [NUCLEAR GHOST SHIELD]: If the base prompt from Redis is infected with the legacy "preguntón", purge it.
        if (systemInstruction.toLowerCase().includes('preguntón') || systemInstruction.toLowerCase().includes('focusada')) {
            console.warn('⚠️ [Nuclear Shield] Infected BASE prompt detected. Neutralizing identity.');
            systemInstruction = `[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. ✨🌸
[ESTILO]: Atenta, carismática y 100% humana. Usa emojis con libertad y varía tus expresiones.`;
        }

        // SESSION & VIBE DATA (Injecting RAW data for the LLM to process according to the VISIBLE prompt)
        console.log(`[AI DEBUG] Session timer for ${candidateId}: ${minSinceLastBot} min.`);
        systemInstruction += `\n[CONTEXTO DE TIEMPO]: Han pasado ${minSinceLastBot} minutos desde el último mensaje de Brenda.`;
        if (botHasSpoken) systemInstruction += `\n[HISTORIAL]: Ya has hablado con este candidato anteriormente.`;

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos. SI NO SABES EL NOMBRE REAL (Persona), NO LO INVENTES Y PREGÚNTALO.\n`;

        // Use cache if feature flag enabled, otherwise direct Redis
        const aiConfigJson = FEATURES.USE_BACKEND_CACHE
            ? await getCachedConfig(redis, 'ai_config')
            : await redis?.get('ai_config');

        let apiKey = process.env.GEMINI_API_KEY;
        let ignoreVacanciesGate = false;
        if (aiConfigJson) {
            const parsed = JSON.parse(aiConfigJson);
            if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            if (parsed.ignoreVacancies) ignoreVacanciesGate = true;
        }

        // --- NEW: Assistant 2.0 Intent Detection ---
        const userText = String(incomingMessage?.content || incomingMessage || '').trim();
        const historyText = validMessages.map(m => `${m.from}: ${m.content}`).join('\n');
        const intent = await classifyIntent(candidateId, userText, historyText, hasAudio);
        console.log(`[Assistant 2.0] Intent detected for ${candidateId}: ${intent} (HasAudio: ${hasAudio})`);

        const DECISION_MATRIX = {
            'AUDIO_INTERACTION': '\n[INTENTO: AUDIO]: El usuario envió un audio. ES PRIORITARIO procesar el contenido de este audio. Escucha lo que dice y responde con COHERENCIA TOTAL a su petición o duda. SI PREGUNTA POR VACANTES O SUELDOS, responde con la verdad o indica que estás revisando, pero NO IGNORES lo que dijo en el audio. Primero reconoce el audio ("Te escucho...") y luego responde al fondo.',
            'ATTENTION': '\n[INTENTO: ATENCIÓN]: El usuario te está llamando. Responde con un saludo carismático. NO hables de trabajo. Solo sé Brenda. ✨',
            'SMALL_TALK': '\n[INTENTO: PLÁTICA]: El usuario está socializando. Responde con gracia y coherencia. Si es un halago, se vale bromear. Prohibido mencionar el proceso de selección o vacantes. 💅',
            'CLOSURE': '\n[INTENTO: DESPEDIDA]: El usuario se despide o confirma el cierre de la conversación.\nRESPONDE: Despídete de forma amigable y breve.\nVARIACIONES: \"¡Nos vemos!\", \"¡Hasta pronto!\", \"¡Cuídate!\", \"¡Suerte!\", \"¡Ánimo!\", \"¡Que te vaya super!\"\nPROHIBIDO ABSOLUTO: Mencionar vacantes, trabajo, o seguir la conversación. Solo despídete.',
            'DATA_GIVE': '\n[INTENTO: DATOS]: El usuario mandó información. Dile "¡Anotado! 📍" o similar y sigue el flujo natural.',
            'QUERY': '\n[INTENTO: DUDA]: El usuario quiere saber algo. Responde con la verdad de su proceso pero mantente breve.',
            'UNKNOWN': '\n[INTENTO: FLUIDO]: Responde siguiendo el flujo natural de la conversación con coherencia total.'
        };

        const lastBotMessages = validMessages
            .filter(m => (m.from === 'bot' || m.from === 'me') && !m.meta?.proactiveLevel)
            .slice(-3)
            .map(m => m.content.trim());

        // --- NEW: Unified Extraction Protocol ---
        let categoriesList = "";
        try {
            const categoriesData = FEATURES.USE_BACKEND_CACHE
                ? await getCachedConfig(redis, 'candidatic_categories')
                : await redis?.get('candidatic_categories');
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
- Municipio: ${candidateData.municipio || 'No proporcionado'}
- Categoría: ${candidateData.categoria || 'No proporcionado'}
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

        // --- BIFURCACIÓN DE CEREBROS (CANDIDATIC ARCHITECTURE) ---
        const isInWaitingRoom = audit.paso1Status === 'COMPLETO' && !candidateData.projectMetadata?.projectId;

        if (ignoreVacanciesGate || audit.paso1Status === 'INCOMPLETO') {
            // --- CEREBRO 1: BRENDA CAPTURISTA (Paso 1 - Datos) ---
            const categoriesData = FEATURES.USE_BACKEND_CACHE
                ? await getCachedConfig(redis, 'candidatic_categories')
                : await redis?.get('candidatic_categories');
            const categories = categoriesData ? JSON.parse(categoriesData).map(c => c.name) : [];

            let catInstruction = '';
            if (categories.length > 0) {
                catInstruction = `\n[LISTADO DE CATEGORÍAS OFICIALES]:\n${categories.map(c => `✅ ${c}`).join('\n')}
REGLA: Usa estas categorías. Si el usuario pide otra cosa, redirígelo amablemente.`;
            }

            systemInstruction += `\n[ESTADO: CAPTURISTA BRENDA 📝]:
1. TU OBJETIVO: Recolectar datos faltantes: ${audit.missingLabels.join(', ')}.
2. REGLA DE ORO: Pide solo UN dato a la vez. No abrumes.
3. TONO: Profesional, tierno y servicial. No platiques de más, enfócate en llenar el formulario.
4. SILENCIO DE VACANTES: El perfil está incompleto. PROHIBIDO dar detalles de sueldos o empresas. ✨
${catInstruction}\n`;
        } else if (isInWaitingRoom) {
            // --- CEREBRO 2: SALA DE ESPERA (Datos completos, sin proyecto) ---
            console.log(`🌸 [Waiting Room Mode] Activado para ${candidateData.nombreReal || candidateData.whatsapp}`);
            console.log(`🎯 [Intent Detected]: ${intent}`);

            let waitingRoomPrompt = (assistantCustomPrompt || DEFAULT_ASSISTANT_PROMPT);

            systemInstruction += `\n${waitingRoomPrompt}\n`;

            systemInstruction += `\n[CONTEXTO DE SALA DE ESPERA]:
- El candidato YA TIENE perfil completo ✅
- Nombre: ${candidateData.nombreReal || 'No proporcionado'}
- Categoría: ${candidateData.categoria || 'No especificada'}
- Municipio: ${candidateData.municipio || 'No especificado'}

[INTENCIÓN DETECTADA]: ${intent}
${DECISION_MATRIX[intent] || ''}

[REGLAS DE SALA DE ESPERA]:
1. CONVERSACIÓN COHERENTE: Responde EXACTAMENTE a lo que el usuario te dice. Si el mensaje es un AUDIO, procesa su contenido con prioridad 🎙️ y responde con la extensión necesaria para aclarar sus dudas, priorizando tu configuración personalizada.
2. PRIORIDAD AUDIO: Si hay un audio, reconoce que lo escuchaste ("Te escucho...", "Anotado lo que me dices...") y responde a la petición central del audio.
3. SI ES SOCIAL (saludo, charla): Sigue la conversación con naturalidad y carisma.
4. SI ES DESPEDIDA: SOLO despídete de forma amigable. PROHIBIDO mencionar vacantes o trabajo.
5. SI PREGUNTA POR TRABAJO: Di con creatividad que estás buscando opciones. VARÍA cada vez (no copies frases exactas).
6. PROHIBIDO REPETIR: Si ya usaste una frase, NUNCA la repitas exacta. Cambia palabras, emojis, estructura.
7. MÁXIMA NATURALIDAD: Suenas como una reclutadora de 25 años platicando, no como un bot. Respeta la longitud configurada por el usuario.

[MEMORIA DEL HILO - ¡NO REPETIR ESTO!]:
${lastBotMessages.length > 0 ? lastBotMessages.map(m => `- "${m}"`).join('\n') : '(Ninguno aún)'}\n`;
        } else if (!isNameBoilerplate) {
            // --- CEREBRO 3: ASSISTANT 2.0 (Con proyecto asignado) ---
            let originalInstruction = (assistantCustomPrompt || DEFAULT_ASSISTANT_PROMPT);

            systemInstruction += `\n${originalInstruction}\n`;

            systemInstruction += `\n[MEMORIA DEL HILO - ¡NO REPETIR ESTO!]:
${lastBotMessages.length > 0 ? lastBotMessages.map(m => `- "${m}"`).join('\n') : '(Ninguno aún)'}\n`;
        } else {
            // CASO ESPECIAL: Perfil completo pero nombre incorrecto.
            systemInstruction += `\n[ALERTA]: El perfil está completo pero el NOMBRE es incorrecto (boilerplate). Pregúntalo amablemente antes de avanzar.\n`;
        }

        // Only add this instruction for Capturista mode
        if (audit.paso1Status === 'INCOMPLETO') {
            const nextTarget = audit.missingLabels[0];
            systemInstruction += `\n[REGLA DE AVANCE]: Faltan datos. Prioridad actual: "${nextTarget}". Pide solo este dato amablemente.\n`;
        }

        // Final sanity check: if the constructed systemInstruction STILL has the ghost text, filter it line by line.
        if (systemInstruction.toLowerCase().includes('preguntón')) {
            systemInstruction = systemInstruction.split('\n')
                .filter(line => !line.toLowerCase().includes('preguntón') && !line.toLowerCase().includes('focusada'))
                .join('\n');
        }

        // --- NEW: Unified JSON Output Schema ---
        systemInstruction += `\n[FORMATO DE RESPUESTA - OBLIGATORIO JSON]: Tu salida DEBE ser un JSON válido con este esquema:
{
  "extracted_data": { 
     "nombreReal": "string | null",
     "genero": "string | null (Hombre/Mujer)",
     "fechaNacimiento": "string | null (DD/MM/YYYY)",
     "municipio": "string | null",
     "categoria": "string | null",
     "tieneEmpleo": "string | null",
     "escolaridad": "string | null"
  },
  "thought_process": "Razonamiento multinivel: 1. Contexto (¿Se repite?), 2. Análisis Social (¿Hubo piropo/broma?), 3. Misión (¿Qué estoy haciendo?), 4. Redacción (Unir todo amablemente).",
  "audio_transcription": "Si recibiste audio, escribe aquí la transcripción exacta. Si no, pon null.",
  "response_text": "Tu respuesta amable de la Lic. Brenda para el candidato (Sin asteriscos)"
}`;

        // 5. Resilience Loop (Inference)
        const genAI = new GoogleGenerativeAI(apiKey);
        const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
        let result;
        let lastError = '';

        // --- DEBUG: SEE FINAL PROMPT ---
        // console.log("===== FINAL SYSTEM INSTRUCTION =====");
        // console.log(systemInstruction);
        // console.log("=====================================");

        for (const mName of models) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    systemInstruction,
                    generationConfig: {
                        temperature: 0.7,
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
        // 🛡️ [GHOST TRANSCRIPTION HYPER-FIX]: 
        // If the turn is text-only, we MUST clear any hallucinated transcription from Gemini.
        if (!hasAudio) {
            if (aiResult.audio_transcription) {
                console.log(`[AI NUCLEAR SHIELD] Blocked hallucinated ghost transcription: "${aiResult.audio_transcription}"`);
            }
            aiResult.audio_transcription = null;
        }

        let responseText = aiResult.response_text || '';
        responseText = responseText.replace(/\*/g, '');

        // 🛡️ [AUDIO TRANSCRIPTION PERSISTENCE]: Only if Turn has NEW audio
        if (hasAudio && aiResult.audio_transcription && turnAudioUrls.length > 0) {
            const primaryUrl = turnAudioUrls[0];
            const isAlreadyInHistory = validMessages.some(m =>
                (m.meta?.audioUrl === primaryUrl) ||
                (m.content && m.content.toLowerCase().includes(aiResult.audio_transcription.toLowerCase()))
            );

            if (!isAlreadyInHistory) {
                console.log(`[AI DEBUG] Saving verified unique transcription for ${primaryUrl}: "${aiResult.audio_transcription}"`);
                await saveMessage(candidateId, {
                    from: 'user',
                    content: `🎙️ [AUDIO TRANSCRITO]: "${aiResult.audio_transcription}"`,
                    type: 'text',
                    timestamp: new Date().toISOString(),
                    meta: { transcribed: true, audioUrl: primaryUrl }
                });
            } else {
                console.log(`[AI DEBUG] Skipping known/repeated transcription for ${primaryUrl}`);
            }
        }

        // --- CONSOLIDATED SYNC: Update all candidate data in one atomic call ---
        const candidateUpdates = {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString()
        };

        if (aiResult.extracted_data) {
            for (const [key, val] of Object.entries(aiResult.extracted_data)) {
                if (val && val !== 'null' && val !== 'indefinido' && candidateData[key] !== val) {
                    const schema = getSchemaByField(key);
                    let finalVal = val;

                    if (schema && schema.cleaner) {
                        try {
                            const cleaned = await schema.cleaner(val);
                            finalVal = cleaned || val;
                        } catch (e) { console.warn(`Error cleaning ${key}:`, e); }
                    }

                    candidateUpdates[key] = finalVal;

                    // Trigger secondary effects (like gender detection)
                    if (schema && schema.onSuccess) {
                        try {
                            await schema.onSuccess(finalVal, candidateUpdates);
                        } catch (e) { console.warn(`Error trigger for ${key}:`, e); }
                    }
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
// [Vercel Deployment Ping: f678976 Stable Version Restored]
