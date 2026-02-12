import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import {
    getRedisClient,
    getMessages,
    saveMessage,
    updateCandidate,
    getCandidateById,
    auditProfile,
    getProjectById,
    getVacancyById,
    recordAITelemetry,
    moveCandidateStep
} from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig, sendUltraMsgPresence, sendUltraMsgReaction } from '../whatsapp/utils.js';
import { getSchemaByField } from '../utils/schema-registry.js';
import { getCachedConfig, getCachedConfigBatch } from '../utils/cache.js';
import { FEATURES } from '../utils/feature-flags.js';
import { getOpenAIResponse } from '../utils/openai.js';

export const DEFAULT_EXTRACTION_RULES = `
[REGLAS DE EXTRACCIÓN (ADN)]:
1. Analiza el historial para extraer: nombreReal, genero, fechaNacimiento, municipio, categoria, escolaridad, tieneEmpleo.
2. REGLA DE REFINAMIENTO: Si el dato que tienes en [ESTADO DEL CANDIDATO (ADN)] es incompleto y el usuario da más info, FUSIÓNALO.
3. REGLA DE FECHA: Formato DD/MM/YYYY.
4. REGLA DE ESCOLARIDAD (GOLD): "Kinder", "Primaria trunca" o "Ninguna" son INVÁLIDOS. Solo acepta Primaria terminada en adelante.
5. REGLA DE GÉNERO: Infiérelo del nombreReal (Hombre/Mujer).
`;

export const DEFAULT_CEREBRO1_RULES = `
[ESTADO: CAPTURISTA BRENDA 📝]:
1. TU OBJETIVO: Recolectar datos faltantes: {{faltantes}}.
2. REGLA DE ORO: Pide solo UN dato a la vez. No abrumes.
3. TONO: Profesional, tierno y servicial. No pláticas de más, enfócate en llenar el formulario.
4. VARIACIÓN: Si el usuario insista con el mismo tema social, VARÍA tu respuesta. Nunca digas lo mismo dos veces. ✨
5. GUARDIA ADN (ESTRICTO): PROHIBIDO saltar de un dato a otro sin haber obtenido el anterior. Si el usuario bromea o evade, responde con gracia pero vuelve siempre al dato faltante exacto: {{faltantes}}. No digas que el perfil está listo si falta algo.
6. NO COMPLACIENTE: No aceptes datos basura (como Kinder) solo por ser amable. Detén el flujo hasta tener un dato real.
`;

export const DEFAULT_CEREBRO2_CONTEXT = `
[CONTEXTO DE SALA DE ESPERA]:
- El candidato YA TIENE perfil completo ✅
- Nombre: {{nombre}}
- Categoría: {{categoria}}
- Municipio: {{municipio}}

[INTENCIÓN DETECTADA]: {{intent}}
`;

export const DEFAULT_SYSTEM_PROMPT = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. Tono: cálido, profesional, tierno y servicial. ✨🌸

[REGLAS GENERALES]:
1. BREVEDAD: Sigue las instrucciones de longitud del mensaje que el administrador haya configurado en tu identidad. Prohibido usar asteriscos (*).
2. ANCLA Y PUENTE (ELIMINAR SI < 2 HORAS): 
   - SI PASARON > 2 HORAS: Valida lo que dijo el usuario antes de pedir algo (Variedad: "¡Excelente! ✨", "¡Anotado! 📍").
   - SI PASARON < 2 HORAS: Sigue siendo directa, pero TIENES PERMISO de usar puentes sociales si el usuario socializa o bromea. No seas un robot.
3. LISTAS: Usa emoji de check ✅ SOLO para cuando listes vacantes o categorías disponibles.
4. PROTOCOLO DE RECONEXIÓN:
   - PRIMER CONTACTO: Preséntate amablemente 👋 ("¡Hola! Soy la Lic. Brenda Rodríguez...").
   - SI YA HAS HABLADO (< 2 horas): Evita saludos largos, pero mantén la calidez si el contexto lo requiere.
   - SI PASARON > 2 horas: Saludo breve ("¡Qué gusto saludarte de nuevo!").
5. CLIMA: Si el usuario es cortante, sé breve. Si usa emojis, úsalos tú también. 🎉
6. ANTI-REPETICIÓN (PENALIDAD FATAL): Está PROHIBIDO usar las mismas frases o estructuras de [MEMORIA DEL HILO]. Si te repites, fallas en tu misión humana. Cambia palabras, orden y estilo.

[REGLA DE REACCIONES]:
- 👍: Úsalo ÚNICAMENTE cuando decidas cerrar la conversación (close_conversation: true). 
- PROHIBIDAS todas las demás reacciones (🙏, ❤️, etc.) durante la captura de datos para evitar ruidos en las pruebas.

[ESTRATEGIA DE CONVERSACIÓN]:
1. RE-SALUDO: Si Inactividad es "Regreso fresco", inicia con un saludo breve y cálido (ej. "¡Hola de nuevo! ✨") antes de retomar el hilo.
2. CONFIRMACIÓN DE CAMBIOS: Si el usuario corrige un dato (ej. su nombre), tu "response_text" DEBE confirmar explícitamente que ya realizaste el cambio.
3. CIERRE DEFINITIVO: Si ya cerraste la charla (Silencio Operativo: SÍ) y el usuario solo responde con confirmaciones cortas o cortesías (ej. "Ok", "Sale", "Gracias a ti"), NO respondas con texto. Mantén el silencio o usa una reacción (👍).
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

export const processMessage = async (candidateId, incomingMessage, msgId = null) => {
    const startTime = Date.now();
    try {
        const redis = getRedisClient();

        // 1. Initial High-Speed Parallel Acquisition (Memory Boost: 40 messages)
        const [candidateData, config, allMessages] = await Promise.all([
            getCandidateById(candidateId),
            getUltraMsgConfig(),
            getMessages(candidateId, 40)
        ]);

        console.log(`[DEBUG AGENT ENTRY] Candidate: ${candidateId} | Data: ${!!candidateData} | Config: ${!!config} | Messages: ${allMessages.length}`);

        if (!candidateData) return 'ERROR: No se encontró al candidato';

        // 🛡️ [BLOCK SHIELD]: Force silence if candidate is blocked
        if (candidateData.blocked === true) {
            console.log(`[BLOCK SHIELD] Skipping processMessage for blocked candidate: ${candidateId}`);
            return null;
        }

        const validMessages = allMessages.filter(m => m.content && (m.from === 'user' || m.from === 'bot' || m.from === 'me'));

        // 2. Text Extraction (Unified Loop)
        let userParts = [];
        let aggregatedText = "";

        // 🧪 TELEMETRY & AGGREGATION
        const messagesToProcess = (typeof incomingMessage === 'string' && incomingMessage.includes(' | '))
            ? incomingMessage.split(' | ')
            : [incomingMessage];

        console.log(`[Unified Mode] Messages for ${candidateId}: `, messagesToProcess);

        for (const msg of messagesToProcess) {
            let parsed = msg;
            let isJson = false;
            try {
                if (typeof msg === 'string' && (msg.trim().startsWith('{') || msg.trim().startsWith('['))) {
                    parsed = JSON.parse(msg);
                    isJson = true;
                }
            } catch (e) { }

            // 🛡️ [FEEDBACK LOOP SHIELD v2]: Skip any text that looks like a transcription or internal tag
            const textVal = (isJson || typeof parsed === 'object') ? (parsed.body || parsed.content || JSON.stringify(parsed)) : String(parsed || '').trim();

            const isTranscriptionPrefix = textVal.includes('[AUDIO TRANSCRITO]') || textVal.includes('🎙️');
            const isInternalJson = isJson && (parsed.extracted_data || parsed.thought_process);

            if (textVal && textVal !== '{}' && !isTranscriptionPrefix && !isInternalJson) {
                userParts.push({ text: textVal });
                aggregatedText += (aggregatedText ? " | " : "") + textVal;
            }
        }

        if (userParts.length === 0) userParts.push({ text: 'Hola' });

        const recentHistory = validMessages
            .slice(-21, -1) // Memory Boost: 20 messages of history
            .filter(m => {
                const ghostKeywords = ['preguntón', 'focusada', 'procesa su perfil'];
                if ((m.from === 'bot' || m.from === 'me') && ghostKeywords.some(kw => m.content.toLowerCase().includes(kw))) {
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
                    content = `[Mensaje de Lic. Brenda - Seguimiento Automático]: ${content}`;
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

        // b. Nitro Batch Acquisition: Fetch all rules and prompts in one go
        const configKeys = [
            'custom_fields',
            'bot_ia_prompt',
            'assistant_ia_prompt',
            'ai_config',
            'candidatic_categories',
            'bot_extraction_rules',
            'bot_cerebro1_rules'
        ];

        const batchConfig = FEATURES.USE_BACKEND_CACHE
            ? await getCachedConfigBatch(redis, configKeys)
            : await (async () => {
                const values = await redis?.mget(configKeys);
                const obj = {};
                configKeys.forEach((key, i) => obj[key] = values ? values[i] : null);
                return obj;
            })();

        const customFields = batchConfig.custom_fields ? JSON.parse(batchConfig.custom_fields) : [];
        const audit = auditProfile(candidateData, customFields);
        const initialStatus = audit.paso1Status;

        const customPrompt = batchConfig.bot_ia_prompt || '';
        const assistantCustomPrompt = batchConfig.assistant_ia_prompt || '';

        let systemInstruction = getIdentityLayer(customPrompt);

        // --- GRACE & SILENCE ARCHITECTURE ---
        const isNewFlag = candidateData.esNuevo === 'SI';
        const hasGratitude = candidateData.gratitudAlcanzada === true || candidateData.gratitudAlcanzada === 'true';
        const isSilenced = candidateData.silencioActivo === true || candidateData.silencioActivo === 'true';
        const isLongSilence = minSinceLastBot >= 5;

        // Total Responsiveness Logic: Any incoming message breaks previous silence.
        let currentHasGratitude = false;
        let currentIsSilenced = false;

        if (isSilenced || hasGratitude) {
            console.log(`[Total Responsiveness] Breaking previous silence/gratitude for ${candidateId} due to new message.`);
        }

        const isProfileComplete = audit.paso1Status === 'COMPLETO';
        systemInstruction += `\n[ESTADO DE MISIÓN]:
- PERFIL COMPLETADO: ${isProfileComplete ? 'SÍ (SKIP EXTRACTION)' : 'NO (DATA REQUIRED)'}
- ¿Es Primer Contacto?: ${isNewFlag ? 'SÍ (Presentarse)' : 'NO (Ya saludaste)'}
- Gratitud Alcanzada: ${currentHasGratitude ? 'SÍ (Ya te dio las gracias)' : 'NO (Aún no te agradece)'}
- Silencio Operativo: ${currentIsSilenced ? 'SÍ (La charla estaba cerrada)' : 'NO (Charla activa)'}
- Inactividad: ${minSinceLastBot} min (${isLongSilence ? 'Regreso fresco' : 'Hilo continuo'})
\n[REGLA CRÍTICA]: SI [PERFIL COMPLETADO] ES SÍ, NO pidas datos proactivamente. Sin embargo, SI el usuario provee información nueva o corrige un dato (ej. "quiero cambiar mi nombre"), PROCÉSALO en extracted_data y confirma el cambio amablemente.`;

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos. SI NO SABES EL NOMBRE REAL (Persona), NO LO INVENTES Y PREGÚNTALO.\n`;

        // Use Nitro Cached Config
        const aiConfigJson = batchConfig.ai_config;

        let apiKey = process.env.GEMINI_API_KEY;
        let ignoreVacanciesGate = false;
        if (aiConfigJson) {
            const parsed = typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson;
            if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            if (parsed.ignoreVacancies) ignoreVacanciesGate = true;
        }

        // --- PRE-PROCESS: User Voice/Text Aggregation ---
        const userText = aggregatedText;

        const lastBotMessages = validMessages
            .filter(m => (m.from === 'bot' || m.from === 'me') && !m.meta?.proactiveLevel)
            .slice(-20) // Extended unique history
            .map(m => m.content.trim());

        // --- Nitro Extraction Protocol ---
        let categoriesList = "";
        const categoriesData = batchConfig.candidatic_categories;
        if (categoriesData) {
            try {
                const cats = JSON.parse(categoriesData).map(c => c.name);
                categoriesList = cats.join(', ');
            } catch (e) { }
        }

        const customExtractionRules = batchConfig.bot_extraction_rules;
        const extractionRules = (customExtractionRules || DEFAULT_EXTRACTION_RULES)
            .replace('{{categorias}}', categoriesList)
            .replace('CATEGORÍAS VÁLIDAS: ', `CATEGORÍAS VÁLIDAS: ${categoriesList}`);

        systemInstruction += `\n[ESTADO DEL CANDIDATO (BRÚJULAS)]:
- Perfil Completo: ${audit.paso1Status === 'COMPLETO' ? 'SÍ' : 'NO'}
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

        // --- CEREBRO MAESTRO ÚNICO (DYNAMICS) ---

        if (isNewFlag) {
            systemInstruction += `\n[MISIÓN ACTUAL: BIENVENIDA]: Es el primer mensaje. Preséntate como la Lic. Brenda y pide el Nombre completo para iniciar el registro. ✨🌸\n`;
        } else if (!isProfileComplete) {
            const categoriesData = batchConfig.candidatic_categories;
            const categories = categoriesData ? JSON.parse(categoriesData).map(c => c.name) : [];

            let catInstruction = '';
            if (categories.length > 0) {
                catInstruction = `\n[LISTADO DE CATEGORÍAS OFICIALES]: \n${categories.map(c => `✅ ${c}`).join('\n')}
REGLA: Usa estas categorías. Si el usuario pide otra cosa, redirígelo amablemente.`;
            }

            const customCerebro1Rules = batchConfig.bot_cerebro1_rules;
            const cerebro1Rules = (customCerebro1Rules || DEFAULT_CEREBRO1_RULES)
                .replace('{{faltantes}}', audit.missingLabels.join(', '));

            systemInstruction += `\n${cerebro1Rules} \n${catInstruction} \n`;

            const nextTarget = audit.missingLabels[0];
            systemInstruction += `\n[REGLA DE AVANCE]: Faltan datos. Prioridad actual: "${nextTarget}". Pide solo este dato amablemente.\n`;
        } else {
            // PERFIL COMPLETO: MODO SOCIAL / GRACIA / SILENCIO
            if (!hasGratitude) {
                systemInstruction += `\n[MISIÓN ACTUAL: BUSCAR GRATITUD]: El perfil está completo. Sé súper amable, dile que le va a ir genial y busca que el usuario te dé las gracias. ✨💅\n`;
            } else {
                systemInstruction += `\n[MISIÓN ACTUAL: OPERACIÓN SILENCIO]: El usuario ya te dio las gracias. Ya cumpliste. NO escribas texto (response_text: null). SOLO pon una reacción (👍) y marca close_conversation: true. 👋🤫\n`;
            }
        }

        systemInstruction += `\n[MEMORIA DEL HILO - ¡PROHIBIDO REPETIR ESTO!]:
${lastBotMessages.length > 0 ? lastBotMessages.map(m => `- "${m}"`).join('\n') : '(Ninguno aún)'} \n`;

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
    "reaction": "emoji_char | null (Usa 👍 SOLO cuando cierres la conversación)",
    "trigger_media": "string | null (Usa 'success_sticker' SOLO cuando el perfil se complete en este mensaje exacto)",
    "response_text": "Tu respuesta amable de la Lic. Brenda para el candidato (Sin asteriscos). Si decides solo reaccionar, deja esto null.",
    "gratitude_reached": "boolean (Activa true si el usuario te dio las gracias en este mensaje)",
    "close_conversation": "boolean (Activa true si decides que ya no hay nada más que decir y solo cerrarás con reacción o silencio)"
} `;

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
                        maxOutputTokens: 1000,
                        temperature: 0.72,
                        topP: 0.95,
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

        const textResult = result.response.text();

        // --- GOLD JSON RESILIENCE (Titan Grade) ---
        let aiResult;
        try {
            // Remove markdown code blocks and cleanup whitespace
            const sanitized = textResult.replace(/```json|```/g, '').trim();
            aiResult = JSON.parse(sanitized);
        } catch (e) {
            console.warn(`[Gold Resilience] Standard JSON parse failed for ${candidateId}. Attempting repair.`);
            try {
                const match = textResult.match(/\{[\s\S]*\}/);
                if (match) {
                    let cleaned = match[0];
                    // Common AI JSON fix: remove trailing commas before closing braces/brackets
                    cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1');
                    aiResult = JSON.parse(cleaned);
                } else {
                    throw new Error('No JSON object found in response');
                }
            } catch (repairErr) {
                console.error(`[Gold Resilience] FATAL JSON failure for ${candidateId}:`, repairErr.message);
                throw new Error('AI Response structure is non-recoverable');
            }
        }
        let responseTextVal = aiResult.response_text || '';
        responseTextVal = responseTextVal.replace(/\*/g, '');

        // --- CONSOLIDATED SYNC: Update all candidate data in one atomic call ---
        const candidateUpdates = {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString()
        };

        if (aiResult.extracted_data) {
            const extractionStartTime = Date.now();
            const extractionEntries = Object.entries(aiResult.extracted_data);

            await Promise.all(extractionEntries.map(async ([key, val]) => {
                if (val && val !== 'null' && val !== 'indefinido' && candidateData[key] !== val) {
                    const schema = getSchemaByField(key);
                    let finalVal = val;

                    if (schema && schema.cleaner) {
                        try {
                            const cleaned = await schema.cleaner(val);
                            finalVal = cleaned || val;
                        } catch (e) { console.warn(`Error cleaning ${key}: `, e); }
                    }

                    candidateUpdates[key] = finalVal;

                    if (schema && schema.onSuccess) {
                        try {
                            await schema.onSuccess(finalVal, candidateUpdates);
                        } catch (e) { console.warn(`Error trigger for ${key}: `, e); }
                    }
                }
            }));
            console.log(`[Nitro ADN] Extraction processing took ${Date.now() - extractionStartTime}ms`);
        }

        // --- SANITY CHECK: Kill 1900 zombies ---
        const yearMatch = String(candidateUpdates.fechaNacimiento || candidateData.fechaNacimiento || '').match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            const yearValue = parseInt(yearMatch[0]);
            if (yearValue < 1940) {
                console.log(`[Sanity Check] Killing year zombie: ${yearValue}`);
                candidateUpdates.fechaNacimiento = null;
            }
        }

        if (isNewFlag) {
            console.log(`[HANDSHAKE] handshake completed for ${candidateId}. Switching esNuevo to 'NO'.`);
            candidateUpdates.esNuevo = 'NO';
        }

        // --- PERSISTENCE: GRACE & SILENCE (Clear on any interaction) ---
        candidateUpdates.gratitudAlcanzada = aiResult.gratitude_reached === true;
        candidateUpdates.silencioActivo = aiResult.close_conversation === true;

        if (candidateUpdates.gratitudAlcanzada) console.log(`[Grace & Silence] Gratitude active for ${candidateId}.`);
        if (candidateUpdates.silencioActivo) console.log(`[Grace & Silence] Silence active for ${candidateId}.`);

        // --- STICKER CELEBRATION (Lock / Candado) ---
        const hasBeenCongratulated = candidateData.congratulated === true || candidateData.congratulated === 'true';
        let stickerPromise = Promise.resolve();
        const finalMerged = { ...candidateData, ...candidateUpdates };
        const finalAudit = auditProfile(finalMerged, customFields);
        const isNowComplete = finalAudit.paso1Status === 'COMPLETO';

        // --- 🤖 GPT HOST PILOT (Filtro Beta Tester: 8116038195) ---
        // Reutilizamos aiConfigJson que ya viene del batchConfig al inicio de la función
        const currentAiConfig = aiConfigJson ? (typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson) : {};

        // Multi-Format Phone Check (Robust)
        const rawPhone = candidateData.whatsapp || '';
        const possibleFormats = [
            rawPhone,
            rawPhone.replace(/\D/g, ''),
            `52${rawPhone.replace(/\D/g, '')}`,
            `521${rawPhone.replace(/\D/g, '')}`
        ];
        const isBetaTester = possibleFormats.some(p => p.endsWith('8116038195'));

        const gptConditions = {
            isNowComplete,
            isBetaTester,
            enabled: currentAiConfig.gptHostEnabled,
            hasKey: !!currentAiConfig.openaiApiKey
        };

        console.log(`[DEBUG GPT HOST] Phone: ${rawPhone} | IsBeta: ${isBetaTester} | Conditions: ${JSON.stringify(gptConditions)}`);

        if ((isNowComplete || isBetaTester) && isBetaTester && currentAiConfig.gptHostEnabled && currentAiConfig.openaiApiKey) {
            console.log(`[GPT Host Pilot] 🧠 User ${candidateData.whatsapp} detected. Calling GPT-4o.`);
            try {
                const hostPrompt = currentAiConfig.gptHostPrompt || 'Eres la Lic. Brenda Rodríguez de Candidatic. Sé amable.';
                const adnContext = `\n[REFERENCIA DEL CANDIDATO (ADN)]: ${JSON.stringify(candidateData)}`;
                const fullSystemPrompt = `${hostPrompt}\n\n${adnContext}`;

                console.log(`[GPT Host Pilot] 🚀 Executing User Prompt: ${hostPrompt.substring(0, 50)}...`);
                const gptResponse = await getOpenAIResponse(allMessages, fullSystemPrompt, currentAiConfig.openaiModel || 'gpt-4o-mini');
                if (gptResponse && gptResponse.content) {
                    console.log(`[GPT Host Pilot] ✨ Response acquired. Latency optimization active.`);
                    responseTextVal = gptResponse.content.replace(/\*/g, ''); // Clean formatting
                }
            } catch (gptErr) {
                console.error(`[GPT Host Pilot] ❌ Failure:`, gptErr.message);
                // Fallback to Gemini (already in responseTextVal)
            }
        }

        const shouldSendSticker = (aiResult.trigger_media === 'success_sticker' || (initialStatus === 'INCOMPLETO' && isNowComplete))
            && isNowComplete
            && !hasBeenCongratulated;

        if (shouldSendSticker) {
            const stickerUrl = await redis?.get('bot_celebration_sticker');
            if (stickerUrl) {
                console.log(`[CELEBRATION] 🎨 Sending validated sticker to ${candidateData.whatsapp}: ${stickerUrl}`);
                // Text Message + Sticker
                const congratsMsg = "¡Felicidades! 🎉 Ya tenemos tu perfil completo. Estaremos en contacto muy pronto. 😊";
                stickerPromise = (async () => {
                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, congratsMsg);
                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, stickerUrl, 'sticker');
                })();
                candidateUpdates.congratulated = true;
            }
        }


        console.log(`[Consolidated Sync] Candidate ${candidateId}: `, candidateUpdates);
        const updatePromise = updateCandidate(candidateId, candidateUpdates);

        // --- PRESENCIA CONSTANTE (Minimum Feedback Logic) ---
        // We do this BEFORE creating promises to ensure fallback reactions are captured.
        if (!responseTextVal || responseTextVal === '[SILENCIO]') {
            if (!aiResult.reaction) {
                console.log(`[Always Present] No text and no reaction from AI. Forcing fallback reaction for ${candidateId}.`);
                aiResult.reaction = '👍'; // Baseline presence
            }
            responseTextVal = null; // Clean up for internal logic
        }

        // --- MESSAGE REACTIONS (AI DRIVEN) ---
        let reactionPromise = Promise.resolve();
        const aiReaction = aiResult.reaction; // This now includes the fallback if needed

        if (msgId && config && aiReaction) {
            console.log(`[AI Reaction] 🧠 Brenda chose: ${aiReaction} for ${candidateId}`);
            reactionPromise = sendUltraMsgReaction(config.instanceId, config.token, msgId, aiReaction);
        }

        // --- MOVE KANBAN LOGIC ---
        const moveToken = (aiResult.thought_process || '').includes('{ move }');
        if (moveToken && candidateData.projectMetadata?.projectId) {
            const project = await getProjectById(candidateData.projectMetadata.projectId);
            const steps = project?.steps || [];
            const currentIndex = steps.findIndex(s => s.id === (candidateData.projectMetadata.stepId || 'step_new'));
            if (currentIndex !== -1 && steps[currentIndex + 1]) {
                await moveCandidateStep(project.id, candidateId, steps[currentIndex + 1].id);
            }
        }

        // Final Persistence
        let deliveryPromise = Promise.resolve();

        if (responseTextVal) {
            deliveryPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseTextVal);
        } else {
            console.log(`[Presencia Constante] Text suppressed for ${candidateId}. Final Reaction: ${aiResult.reaction}`);
        }


        await Promise.allSettled([
            deliveryPromise,
            stickerPromise,
            reactionPromise,
            saveMessage(candidateId, { from: 'bot', content: responseTextVal || '[REACCIÓN/SILENCIO]', timestamp: new Date().toISOString() }),
            updatePromise
        ]);

        return responseTextVal || '[SILENCIO]';

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
