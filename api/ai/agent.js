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

export const DEFAULT_EXTRACTION_RULES = `
[REGLAS DE EXTRACCIÓN (ADN)]:
1. Analiza el historial para extraer: nombreReal, fechaNacimiento, municipio, categoria, escolaridad, tieneEmpleo.
2. REGLA DE REFINAMIENTO: Si el dato que tienes en [ESTADO DEL CANDIDATO (ADN)] es incompleto (ej. "Oscar" o "mayo 1983") y el usuario da más info, FUSIÓNALO para tener el dato completo (ej. "Oscar Rodriguez" o "19/05/1983").
3. REGLA DE FECHA: Formato DD/MM/YYYY. Infiere siglo obligatoriamente (ej. 83 -> 1983, 01 -> 2001).
4. REGLA DE UBICACIÓN: Acepta "Santa" (Santa Catarina), "San Nico" (San Nicolás), etc.
5. REGLA DE CATEGORÍA: Solo categorías válidas del sistema.
6. REGLA DE NOMBRE: Solo nombres reales de personas. No lugares o evasiones.
7. REGLA DE FECHA (CRÍTICA): DD/MM/YYYY. SI EL USUARIO NO DA EL AÑO, NO LO INVENTES. Pídelo amablemente. Prohibido inferir años si no hay certeza (ej. "19 mayo" no es "19/05/1900").
8. REGLA DE ESCOLARIDAD: "Kinder", "Primaria trunca" o "Ninguna" son datos INVÁLIDOS. Si el usuario los da, dile que necesitas al menos Primaria terminada para avanzar.
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

        // 1. Initial High-Speed Parallel Acquisition
        const [candidateData, config, allMessages] = await Promise.all([
            getCandidateById(candidateId),
            getUltraMsgConfig(),
            getMessages(candidateId, 20)
        ]);

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
            .slice(0, -1)
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

        // Initialize system instruction with core logic context
        let systemInstruction = "";

        // 1. STATE & MISSION LAYER (Contextual Foundation)
        const isNewFlag = candidateData.esNuevo === 'SI';
        const hasGratitude = candidateData.gratitudAlcanzada === true || candidateData.gratitudAlcanzada === 'true';
        const isSilenced = candidateData.silencioActivo === true || candidateData.silencioActivo === 'true';
        const isLongSilence = minSinceLastBot >= 5;

        // Reset silence if user writes back after a long time
        let currentHasGratitude = hasGratitude;
        let currentIsSilenced = isSilenced;

        if (isSilenced && isLongSilence) {
            console.log(`[Grace & Silence] 5m Gap detected. Resetting silence for fresh start.`);
            currentIsSilenced = false;
            currentHasGratitude = false;
        }

        const isProfileComplete = audit.paso1Status === 'COMPLETO';

        systemInstruction += `[ESTADO ACTUAL DEL SISTEMA]:
- PERFIL COMPLETADO: ${isProfileComplete ? 'SÍ (SKIP PROACTIVE EXTRACTION)' : 'NO (DATA REQUIRED)'}
- primer_contacto: ${isNewFlag ? 'SÍ' : 'NO'}
- gratitud_alcanzada: ${currentHasGratitude ? 'SÍ' : 'NO'}
- silencio_operativo: ${currentIsSilenced ? 'SÍ' : 'NO'}
- inactividad: ${minSinceLastBot} min (${isLongSilence ? 'Regreso fresco' : 'Hilo continuo'})

[REGLA DE COMPORTAMIENTO]:
- Si silencio_operativo es SÍ y el usuario solo envía cortesías (Ok, Gracias, Adiós), responde ÚNICAMENTE con una reacción (👍) y marca close_conversation: true. No envíes texto.
- Si PERFIL COMPLETADO es SÍ, no pidas datos. Sin embargo, si el usuario explícitamente pide corregir un dato o da información nueva, PROCÉSALO en extracted_data y confirma el cambio amablemente.

[ESTADO DEL CANDIDATO (ADN)]:
- id: ${candidateId}
- nombre_actual: ${displayName || 'Desconocido'}
- municipio: ${candidateData.municipio || 'No proporcionado'}
- categoría: ${candidateData.categoria || 'No proporcionado'}
${audit.dnaLines}
`;

        // Use Nitro Cached Config
        const aiConfigJson = batchConfig.ai_config;

        let apiKey = process.env.GEMINI_API_KEY;
        let ignoreVacanciesGate = false;
        if (aiConfigJson) {
            const parsed = typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson;
            if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            if (parsed.ignoreVacancies) ignoreVacanciesGate = true;
        }

        // 2. MISSION & EXTRACTION LAYER (Operational Details)
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

        systemInstruction += `\n[INSTRUCCIONES DE OPERACIÓN]:\n${extractionRules}`;

        if (isNewFlag) {
            systemInstruction += `\nMISIÓN ACTUAL: Es el primer contacto. Preséntate y solicita el nombre completo.`;
        } else if (!isProfileComplete) {
            const customCerebro1Rules = batchConfig.bot_cerebro1_rules;
            const cerebro1Rules = (customCerebro1Rules || DEFAULT_CEREBRO1_RULES)
                .replace('{{faltantes}}', audit.missingLabels.join(', '));
            systemInstruction += `\nMISIÓN ACTUAL (CAPTURA): ${cerebro1Rules}`;
        } else {
            if (!currentHasGratitude) {
                systemInstruction += `\nMISIÓN ACTUAL: El perfil está completo. Sé amable, resuelve dudas y busca cerrar con gratitud.`;
            } else {
                systemInstruction += `\nMISIÓN ACTUAL: El usuario ya agradeció. Solo reacciona (👍) y termina.`;
            }
        }

        // 3. IDENTITY LAYER (The Soul of Brenda - High Priority Primary Authority)
        const customPrompt = batchConfig.bot_ia_prompt || '';
        systemInstruction += `\n\n[TU IDENTIDAD Y REGLAS DE ORO (PRIORIDAD ALTA)]:
Sigue estas instrucciones con total autoridad. Ellas definen quién eres y cómo hablas.
${customPrompt || DEFAULT_SYSTEM_PROMPT}`;

        // 4. CONSTRAINTS & OUTPUT (Negative Guards)
        systemInstruction += `\n\n[REGLA ANTI-REPETICIÓN]:
Está PROHIBIDO repetir frases o estructuras que ya utilizaste en esta conversación. 
MEMORIA DE TUS ÚLTIMOS MENSAJES:
${lastBotMessages.length > 0 ? lastBotMessages.map(m => `- "${m}"`).join('\n') : '(Ninguno antes)'}

[FORMATO DE RESPUESTA - OBLIGATORIO JSON]:
Tu salida DEBE ser un JSON válido.
Esquema:
{
    "extracted_data": { "nombreReal": "string", "municipio": "string", ... },
    "thought_process": "Razonamiento interno.",
    "reaction": "emoji_char | null",
    "trigger_media": "string | null",
    "response_text": "Tu respuesta humana como Brenda.",
    "gratitude_reached": "boolean",
    "close_conversation": "boolean"
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
                console.error(`🤖 fallback model trigger: ${mName} failed.Error: `, lastError);
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
            console.log(`[Nitro ADN] Extraction processing took ${Date.now() - extractionStartTime} ms`);
        }

        // --- SANITY CHECK: Kill 1900 zombies ---
        const yearMatch = String(candidateUpdates.fechaNacimiento || candidateData.fechaNacimiento || '').match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            const yearValue = parseInt(yearMatch[0]);
            if (yearValue < 1940) {
                console.log(`[Sanity Check] Killing year zombie: ${yearValue} `);
                candidateUpdates.fechaNacimiento = null;
            }
        }

        if (isNewFlag) {
            console.log(`[HANDSHAKE] handshake completed for ${candidateId}.Switching esNuevo to 'NO'.`);
            candidateUpdates.esNuevo = 'NO';
        }

        // --- PERSISTENCE: GRACE & SILENCE ---
        if (aiResult.gratitude_reached) {
            console.log(`[Grace & Silence] Gratitude detected for ${candidateId}.Marking flag.`);
            candidateUpdates.gratitudAlcanzada = true;
        }

        if (aiResult.close_conversation) {
            console.log(`[Grace & Silence] Closing conversation for ${candidateId}.Marking silence.`);
            candidateUpdates.silencioActivo = true;
        }

        // Fresh Start reset
        if (isSilenced && isLongSilence) {
            candidateUpdates.silencioActivo = false;
            candidateUpdates.gratitudAlcanzada = false;
        }

        console.log(`[Consolidated Sync] Candidate ${candidateId}: `, candidateUpdates);
        const updatePromise = updateCandidate(candidateId, candidateUpdates);

        // --- MESSAGE REACTIONS (AI DRIVEN) ---
        let reactionPromise = Promise.resolve();
        const aiReaction = aiResult.reaction;

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

        if (responseTextVal && responseTextVal !== 'null') {
            deliveryPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseTextVal);
        } else {
            console.log(`[Grace & Silence] Text suppressed for ${candidateId}(Only reaction or silence).`);
        }

        // --- STICKER CELEBRATION (AI DRIVEN + AUDIT SHIELD) ---
        const hasBeenCongratulated = candidateData.congratulated === true || candidateData.congratulated === 'true';
        let stickerPromise = Promise.resolve();
        const finalMerged = { ...candidateData, ...candidateUpdates };
        const finalAudit = auditProfile(finalMerged, customFields);
        const isNowComplete = finalAudit.paso1Status === 'COMPLETO';

        const shouldSendSticker = (aiResult.trigger_media === 'success_sticker' || (initialStatus === 'INCOMPLETO' && isNowComplete))
            && isNowComplete
            && !hasBeenCongratulated;

        if (shouldSendSticker) {
            const stickerUrl = await redis?.get('bot_celebration_sticker');
            if (stickerUrl) {
                console.log(`[CELEBRATION] 🎨 Sending validated sticker to ${candidateData.whatsapp}: ${stickerUrl} `);
                stickerPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, stickerUrl, 'sticker');
                candidateUpdates.congratulated = true;
            }
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
