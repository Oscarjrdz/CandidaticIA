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
    moveCandidateStep,
    addCandidateToProject
} from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig, sendUltraMsgPresence, sendUltraMsgReaction } from '../whatsapp/utils.js';
import { getSchemaByField } from '../utils/schema-registry.js';
import { getCachedConfig, getCachedConfigBatch } from '../utils/cache.js';
import { FEATURES } from '../utils/feature-flags.js';
import { getOpenAIResponse } from '../utils/openai.js';
import { processRecruiterMessage } from './recruiter-agent.js';

export const DEFAULT_EXTRACTION_RULES = `
[REGLAS DE EXTRACCIÓN]:
1. Analiza el historial para extraer: nombreReal, genero, fechaNacimiento, edad, municipio, categoria, escolaridad, tieneEmpleo.
2. REGLA DE REFINAMIENTO: Si el dato que tienes en [ESTADO DEL CANDIDATO] es incompleto y el usuario da más info, FUSIÓNALO.
3. REGLA DE FECHA: Formato DD/MM/YYYY.
4. REGLA DE ESCOLARIDAD (GOLD): "Kinder", "Primaria trunca" o "Ninguna" son INVÁLIDOS. Solo acepta Primaria terminada en adelante.
5. REGLA DE GÉNERO: Infiérelo del nombreReal (Hombre/Mujer).
6. REGLA TELEFONO: JAMÁS preguntes el número de teléfono/celular. Ya lo tienes (campo 'whatsapp').
7. REGLA DE CATEGORÍA: Solo acepta categorías válidas: {{categorias}}.
`;

export const DEFAULT_CEREBRO1_RULES = `
[ESTADO: CAPTURISTA BRENDA 📝]:
1. TU OBJETIVO: Recolectar datos faltantes: {{faltantes}}.
2. REGLA DE ORO: Pide solo UN dato a la vez. No abrumes.
3. TONO: Profesional, tierno y servicial. No pláticas de más, enfócate en llenar el formulario.
4. VARIACIÓN: Si el usuario insista con el mismo tema social, VARÍA tu respuesta. Nunca digas lo mismo dos veces. ✨
5. GUARDIA ADN (ESTRICTO): PROHIBIDO saltar de un dato a otro sin haber obtenido el anterior. Si el usuario bromea o evade, responde con gracia pero vuelve siempre al dato faltante exacto: {{faltantes}}. No digas que el perfil está listo si falta algo.
6. NO COMPLACIENTE: No aceptes datos basura (como Kinder) solo por ser amable. Detén el flujo hasta tener un dato real.
7. CATEGORÍAS DISPONIBLES: {{categorias}}. Usa esta lista para guiar al usuario si pregunta qué vacantes hay.
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
- El sistema pondrá un 👍 automático si detectas gratitud (gratitude_reached: true).
- GRATITUD (ESTRICTO): Solo si dicen "Gracias", "Agradecido", "Muchas gracias".
- NO ES GRATITUD: "Bye", "Adios", "Ok", "Enterado", "Sale". NO pongas Like en estos.
- NO intentes usar reacciones manuales en "reaction", el sistema las ignora.

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
3. IDENTIDAD: Tienes acceso a los datos del candidato ([Estado del Candidato]). Úsalos con naturalidad si te preguntan quiénes son o qué sabes de ellos.
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

        console.log(`[DEBUG AGENT ENTRY] Candidate: ${candidateId} | Messages: ${allMessages.length}`);


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
            'bot_cerebro1_rules',
            'bypass_enabled'
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

        const isProfileComplete = audit.paso1Status === 'COMPLETO';
        systemInstruction += `\n[ESTADO DE MISIÓN]:
- PERFIL COMPLETADO: ${isProfileComplete ? 'SÍ (SKIP EXTRACTION)' : 'NO (DATA REQUIRED)'}
- ¿Es Primer Contacto?: ${isNewFlag && !isProfileComplete ? 'SÍ (Presentarse)' : 'NO (Ya saludaste)'}
- Gratitud Alcanzada: ${currentHasGratitude ? 'SÍ (Ya te dio las gracias)' : 'NO (Aún no te agradece)'}
- Silencio Operativo: ${currentIsSilenced ? 'SÍ (La charla estaba cerrada)' : 'NO (Charla activa)'}
- Inactividad: ${minSinceLastBot} min (${isLongSilence ? 'Regreso fresco' : 'Hilo continuo'})
\n[REGLA CRÍTICA]: SI [PERFIL COMPLETADO] ES SÍ, NO pidas datos proactivamente. Sin embargo, SI el usuario provee información nueva o corrige un dato (ej. "quiero cambiar mi nombre"), PROCÉSALO en extracted_data y confirma el cambio amablemente.`;

        // Use Nitro Cached Config
        const aiConfigJson = batchConfig.ai_config;

        // 🧨 RESET COMMAND (TEMPORARY FOR TESTING)
        if (incomingMessage === 'RESET') {
            if (candidateData && candidateData.whatsapp) {
                const phone = candidateData.whatsapp;
                const id = candidateId;
                await redis.del(`candidatic:candidate:${id}`);
                await redis.hdel('candidatic:phone_index', phone);
                if (config) {
                    await sendUltraMsgMessage(config.instanceId, config.token, phone, "🧨 DATOS BORRADOS. Eres un usuario nuevo. Di 'Hola' para empezar.");
                }
                return 'RESET_DONE';
            }
        }

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos. SI NO SABES EL NOMBRE REAL (Persona), NO LO INVENTES Y PREGÚNTALO.\n`;

        let apiKey = process.env.GEMINI_API_KEY;
        if (aiConfigJson) {
            const parsed = typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson;
            if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
        }

        const userText = aggregatedText;
        const currentMessageForGpt = {
            role: 'user',
            parts: [{ text: userText }]
        };

        const lastBotMessages = validMessages
            .filter(m => (m.from === 'bot' || m.from === 'me') && !m.meta?.proactiveLevel)
            .slice(-20) // Extended unique history
            .map(m => m.content.trim());

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

        systemInstruction += `\n[ESTADO DEL CANDIDATO]:
- Perfil Completo: ${audit.paso1Status === 'COMPLETO' ? 'SÍ' : 'NO'}
- Nombre Real: ${candidateData.nombreReal || 'No proporcionado'}
- WhatsApp: ${candidateData.whatsapp}
- Municipio: ${candidateData.municipio || 'No proporcionado'}
- Categoría: ${candidateData.categoria || 'No proporcionado'}
${audit.dnaLines}
- Temas recientes: ${themes || 'Nuevo contacto'}
\n[CATEGORÍAS VÁLIDAS EN EL SISTEMA]: ${categoriesList}\n
\n${extractionRules}`;

        let activeProjectId = candidateData.projectId || candidateData.projectMetadata?.projectId;
        let activeStepId = candidateData.stepId || candidateData.projectMetadata?.stepId || 'step_new';

        if (!activeProjectId) {
            const client = getRedisClient();
            activeProjectId = await client.hget('index:cand_project', candidateId);
            if (activeProjectId) {
                const rawMeta = await client.hget(`project:cand_meta:${activeProjectId}`, candidateId);
                const meta = rawMeta ? JSON.parse(rawMeta) : {};
                activeStepId = meta.stepId || 'step_new';
            }
        }

        let aiResult = null;
        let isRecruiterMode = false;
        let responseTextVal = null;
        const historyForGpt = [...recentHistory, currentMessageForGpt];

        if (activeProjectId) {
            const project = await getProjectById(activeProjectId);
            const currentStep = project?.steps?.find(s => s.id === activeStepId) || project?.steps?.[0];

            if (currentStep?.aiConfig?.enabled && currentStep.aiConfig.prompt) {
                console.log(`[BIFURCATION] 🚀 Handing off to RECRUITER BRAIN for candidate ${candidateId}`);
                isRecruiterMode = true;
                const activeAiConfig = batchConfig.ai_config ? (typeof batchConfig.ai_config === 'string' ? JSON.parse(batchConfig.ai_config) : batchConfig.ai_config) : {};
                aiResult = await processRecruiterMessage(
                    candidateData,
                    project,
                    currentStep,
                    historyForGpt,
                    config,
                    activeAiConfig.openaiApiKey
                );
            }
        }

        // --- BIFURCATION POINT: Silence Shield / Recruiter / GPT Host / Gemini ---
        const bridgeCounter = (typeof candidateData.bridge_counter === 'number') ? parseInt(candidateData.bridge_counter || 0) : 0;
        let isBridgeActive = false;
        let isHostMode = false;
        const hasBeenCongratulated = candidateData.congratulated === true || candidateData.congratulated === 'true';

        // 1. SILENCE SHIELD (Exactly 2 messages after sticker)
        if (!isRecruiterMode && isProfileComplete && hasBeenCongratulated && bridgeCounter < 2) {
            console.log(`[Silence Shield] Active for ${candidateId}. Count: ${bridgeCounter}`);
            isBridgeActive = true;

            const lowerText = aggregatedText.toLowerCase();
            const gratitudeKeywords = ['gracias', 'grx', 'thx', 'thank', 'agradecid', 'amable', 'bendicion'];
            const hasRealGratitude = gratitudeKeywords.some(kw => lowerText.includes(kw));

            aiResult = {
                reaction: hasRealGratitude ? '👍' : '✨',
                response_text: null,
                close_conversation: true,
                extracted_data: {}
            };
            candidateData.bridge_counter = bridgeCounter + 1;
            candidateData.esNuevo = 'NO'; // Activity breaks "New" status
            responseTextVal = null;
        }

        // 2. GPT HOST (OpenAI Social Brain) - Triggers after 2 messages of silence
        const activeAiConfig = aiConfigJson ? (typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson) : {};
        if (!isRecruiterMode && !isBridgeActive && isProfileComplete && activeAiConfig.gptHostEnabled && activeAiConfig.openaiApiKey) {
            console.log(`[HANDOVER] 🚀 Handing off to GPT HOST (OpenAI) for candidate ${candidateId}`);
            isHostMode = true;
            try {
                const hostPrompt = activeAiConfig.gptHostPrompt || 'Eres la Lic. Brenda Rodríguez de Candidatic.';
                const gptResponse = await getOpenAIResponse(allMessages, `${hostPrompt}\n[ADN]: ${JSON.stringify(candidateData)}`, activeAiConfig.openaiModel || 'gpt-4o-mini', activeAiConfig.openaiApiKey);

                if (gptResponse?.content) {
                    const textContent = gptResponse.content.replace(/\*/g, '');
                    aiResult = {
                        response_text: textContent,
                        thought_process: "GPT Host Response",
                        reaction: (/\b(gracias|ti)\b/i.test(textContent)) ? '👍' : null,
                        gratitude_reached: false,
                        close_conversation: false
                    };
                    responseTextVal = textContent;
                }
            } catch (e) {
                console.error('[GPT Host] error:', e);
                isHostMode = false; // Fallback to Gemini if OpenAI fails
            }
        }

        // 3. CAPTURISTA BRAIN (GEMINI) - Only if not handled by others
        if (!isRecruiterMode && !isBridgeActive && !isHostMode) {
            if (isNewFlag) {
                systemInstruction += `\n[MISIÓN ACTUAL: BIENVENIDA]: Es el primer mensaje. Preséntate como la Lic. Brenda y pide el Nombre completo para iniciar el registro. ✨🌸\n`;
            } else if (!isProfileComplete) {
                const customCerebro1Rules = batchConfig.bot_cerebro1_rules;
                const cerebro1Rules = (customCerebro1Rules || DEFAULT_CEREBRO1_RULES)
                    .replace('{{faltantes}}', audit.missingLabels.join(', '))
                    .replace(/{{categorias}}/g, categoriesList);
                systemInstruction += `\n${cerebro1Rules} \n`;
            } else {
                if (!hasGratitude) {
                    systemInstruction += `\n[MISIÓN ACTUAL: BUSCAR GRATITUD]: El perfil está completo. Sé súper amable, dile que le va a ir genial y busca que el usuario te dé las gracias. ✨💅\n`;
                } else {
                    systemInstruction += `\n[MISIÓN ACTUAL: OPERACIÓN SILENCIO]: El usuario ya te dio las gracias. Ya cumpliste. NO escribas texto. SOLO pon una reacción (👍) y marca close_conversation: true. 👋🤫\n`;
                }
            }

            systemInstruction += `\n[MEMORIA DEL HILO - ¡PROHIBIDO REPETIR ESTO!]:
${lastBotMessages.length > 0 ? lastBotMessages.map(m => `- "${m}"`).join('\n') : '(Ninguno aún)'} \n`;

            systemInstruction += `\n[FORMATO DE RESPUESTA - OBLIGATORIO JSON]: Tu salida DEBE ser un JSON válido con este esquema:
{
    "extracted_data": { "nombreReal": "string | null", "genero": "string | null", "fechaNacimiento": "string | null", "municipio": "string | null", "categoria": "string | null", "tieneEmpleo": "string | null", "escolaridad": "string | null", "edad": "string | number | null" },
    "thought_process": "Razonamiento.",
    "reaction": "null",
    "trigger_media": "string | null",
    "response_text": "Tu respuesta.",
    "gratitude_reached": "boolean",
    "close_conversation": "boolean"
} `;

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", systemInstruction });
            const chat = model.startChat({ history: recentHistory });
            const result = await chat.sendMessage(userParts);
            const textResult = result.response.text();
            try {
                const sanitized = textResult.replace(/```json|```/g, '').trim();
                aiResult = JSON.parse(sanitized);
                responseTextVal = aiResult.response_text;
            } catch (e) {
                console.error(`[Gemini JSON fail]`, e);
                throw e;
            }
        }

        // --- FINAL CONSOLIDATION ---
        const candidateUpdates = {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString(),
            bridge_counter: candidateData.bridge_counter,
            esNuevo: 'NO'
        };

        if (aiResult?.extracted_data) {
            Object.entries(aiResult.extracted_data).forEach(([key, val]) => {
                if (val && val !== 'null' && candidateData[key] !== val) candidateUpdates[key] = val;
            });
        }

        const finalMerged = { ...candidateData, ...candidateUpdates };
        const finalAudit = auditProfile(finalMerged, customFields);
        const isNowComplete = finalAudit.paso1Status === 'COMPLETO';

        if (isNowComplete && !candidateData.projectId && batchConfig.bypass_enabled === 'true') {
            // Bypass logic can be simplified but let's keep it robust if possible
        }

        if (!isBridgeActive && !isHostMode) {
            if (isNowComplete && aiResult?.gratitude_reached === true) {
                aiResult.reaction = '👍';
            } else if (!aiResult?.reaction && !isRecruiterMode) {
                aiResult.reaction = null;
            }
        }

        let stickerPromise = Promise.resolve();
        const shouldSendSticker = !isRecruiterMode && (initialStatus === 'INCOMPLETO' && isNowComplete) && !hasBeenCongratulated;
        if (shouldSendSticker) {
            const stickerUrl = await redis?.get('bot_celebration_sticker');
            const congratsMsg = "¡Súper! 🌟 Ya tengo tu perfil 100% completo. 📝✅";
            stickerPromise = (async () => {
                await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, congratsMsg);
                if (stickerUrl) await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, stickerUrl, 'sticker');
            })();
            await saveMessage(candidateId, { from: 'bot', content: congratsMsg, timestamp: new Date().toISOString() });
            candidateUpdates.congratulated = true;
            candidateUpdates.bridge_counter = 0;
            candidateUpdates.esNuevo = 'NO';
            responseTextVal = null;

            const finalProjectId = candidateUpdates.projectId || candidateData.projectId;
            if (finalProjectId) {
                const project = await getProjectById(finalProjectId);
                const currentStep = project?.steps?.find(s => s.id === (candidateUpdates.stepId || activeStepId)) || project?.steps?.[0];
                if (currentStep?.aiConfig?.enabled) {
                    const historyWithCongrats = [...historyForGpt, { role: 'model', parts: [{ text: congratsMsg }] }];
                    const recruiterResult = await processRecruiterMessage({ ...candidateData, ...candidateUpdates }, project, currentStep, historyWithCongrats, config, activeAiConfig.openaiApiKey);
                    if (recruiterResult?.response_text) responseTextVal = recruiterResult.response_text;
                }
            }
        }

        const updatePromise = updateCandidate(candidateId, candidateUpdates);
        let reactionPromise = Promise.resolve();
        if (msgId && config && aiResult?.reaction) {
            reactionPromise = sendUltraMsgReaction(config.instanceId, config.token, msgId, aiResult.reaction);
        }

        let deliveryPromise = Promise.resolve();
        const resText = String(responseTextVal || '').trim();
        const isTechnical = !resText ||
            ['null', 'undefined', '[SILENCIO]', '[REACCIÓN/SILENCIO]'].includes(resText) ||
            resText.startsWith('[REACCIÓN:');

        if (responseTextVal && !isTechnical) {
            deliveryPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseTextVal);
        }

        await Promise.allSettled([
            deliveryPromise,
            stickerPromise,
            reactionPromise,
            saveMessage(candidateId, {
                from: 'bot',
                content: responseTextVal || (aiResult?.reaction ? `[REACCIÓN: ${aiResult.reaction}]` : '[SILENCIO]'),
                timestamp: new Date().toISOString()
            }),
            updatePromise
        ]);

        return responseTextVal || '[SILENCIO]';

    } catch (error) {
        console.error('❌ [AI Agent] Fatal Error:', error);
        return "¡Ay! Me distraje un segundo. 😅 ¿Qué me decías?";
    }
};

async function sendFallback(cand, text) {
    const config = await getUltraMsgConfig();
    if (config && cand.whatsapp) {
        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, text);
    }
}
