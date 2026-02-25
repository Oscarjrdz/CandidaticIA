// Deployment trigger: Rollback to stable version confirmed.
import { GoogleGenerativeAI } from "@google/generative-ai";
import { processUnansweredQuestion } from './faq-engine.js';
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
    addCandidateToProject,
    recordVacancyInteraction,
    updateProjectCandidateMeta
} from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig, sendUltraMsgPresence, sendUltraMsgReaction } from '../whatsapp/utils.js';
import { getSchemaByField } from '../utils/schema-registry.js';
import { getCachedConfig, getCachedConfigBatch } from '../utils/cache.js';
import { getOpenAIResponse } from '../utils/openai.js';
import { processRecruiterMessage } from './recruiter-agent.js';
import { inferGender } from '../utils/gender-helper.js';
import { classifyIntent } from './intent-classifier.js';
import { FEATURES } from '../utils/feature-flags.js';

export const DEFAULT_EXTRACTION_RULES = `
[REGLAS DE EXTRACCIÓN Y FORMATEO ZERO-SHOT]:
1. Analiza el historial para extraer: nombreReal, genero, fechaNacimiento, edad, municipio, categoria, escolaridad, tieneEmpleo.
2. REGLA DE REFINAMIENTO: Si el dato que tienes en [ESTADO DEL CANDIDATO] es incompleto y el usuario da más info, FUSIÓNALO.
3. REGLAS DE FORMATEO ESTRICTO (ORO):
   - NOMBRES Y MUNICIPIOS: Guárdalos SIEMPRE en "Title Case" (Ej: "Juan Pérez", "San Nicolás de los Garza"). Corrige ortografía.
   - FECHA: Formato exacto DD/MM/YYYY.
   - ESCOLARIDAD: SOLO acepta: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, Posgrado. (Ej: "Prepa" -> "Preparatoria"). "Kinder" o "Ninguna" son inválidos.
   - CATEGORÍA: Solo acepta categorías de la lista: {{categorias}}. Si dice "Ayudante", guarda "Ayudante General".
   - EMPLEO: Solo guarda "Empleado" o "Desempleado" explícitamente. (Ej: "estoy jalando" -> "Empleado", "buscando", "no tengo chamba" -> "Desempleado").
4. REGLA DE GÉNERO: Infiérelo del nombreReal (Hombre/Mujer).
5. REGLA TELEFONO: JAMÁS preguntes el número de teléfono/celular. Ya lo tienes (campo 'whatsapp').
`;

export const DEFAULT_CEREBRO1_RULES = `
[ESTADO: CAPTURISTA BRENDA 📝]:
1. TU OBJETIVO: Recolectar datos faltantes: {{faltantes}}. (Nota: Para empleo, pregunta directamente si el candidato está "Empleado" o "Desempleado").
2. REGLA DE ORO: Pide solo UN dato a la vez. No abrumes.
3. TONO: Profesional, tierno y servicial. No pláticas de más, enfócate en llenar el formulario.
4. VARIACIÓN: Si el usuario insista con el mismo tema social, VARÍA tu respuesta. Nunca digas lo mismo dos veces. ✨
5. GUARDIA ADN (ESTRICTO): PROHIBIDO saltar de un dato a otro sin haber obtenido el anterior. Si el usuario bromea o evade, responde con gracia pero vuelve siempre al dato faltante exacto: {{faltantes}}. No digas que el perfil está listo si falta algo.
6. NO COMPLACIENTE: No aceptes datos basura (como Kinder) solo por ser amable. Detén el flujo hasta tener un dato real.
7. CATEGORÍAS DISPONIBLES: {{categorias}}. Usa esta lista para guiar al usuario si pregunta qué vacantes hay.
`;

export const DEFAULT_SYSTEM_PROMPT = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. Tono: cálido, profesional, tierno y servicial. ✨🌸

[REGLAS GENERALES]:
1. BREVEDAD: Sigue las instrucciones de longitud del mensaje que el administrador haya configurado en tu identidad. Prohibido usar asteriscos (*).
2. ANCLA Y PUENTE (ELIMINAR SI < 2 HORAS): 
   - SI PERFIL COMPLETO: JAMÁS te vuelvas a presentar. Saluda brevemente ("¡Hola de nuevo!").
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

/**
 * 📅 DATE NORMALIZATION UTILITY
 * Normalizes various birth date formats to DD/MM/YYYY
 * Handles: 10/2/88, 19/5/83, 19/05/1983, etc.
 */
function normalizeBirthDate(input) {
    if (!input || typeof input !== 'string') {
        return { isValid: false, date: null };
    }

    const cleaned = input.trim();

    // Try to parse various formats
    const patterns = [
        // DD/MM/YYYY (already correct)
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
        // DD/MM/YY (2-digit year)
        /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
    ];

    for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match) {
            let [, day, month, year] = match;

            // Convert 2-digit year to 4-digit
            if (year.length === 2) {
                const yy = parseInt(year);
                // Assume 1900s for years 50-99, 2000s for 00-49
                year = yy >= 50 ? `19${year}` : `20${year}`;
            }

            // Pad day and month with leading zeros
            day = day.padStart(2, '0');
            month = month.padStart(2, '0');

            // Validate ranges
            const d = parseInt(day);
            const m = parseInt(month);
            const y = parseInt(year);

            if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > new Date().getFullYear()) {
                return { isValid: false, date: null };
            }

            // Check if date is actually valid (e.g., not Feb 30)
            const testDate = new Date(y, m - 1, d);
            if (testDate.getDate() !== d || testDate.getMonth() !== m - 1) {
                return { isValid: false, date: null };
            }

            return { isValid: true, date: `${day}/${month}/${year}` };
        }
    }

    return { isValid: false, date: null };
}

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

        if (!candidateData) return 'ERROR: No se encontró al candidato';

        // 0. Initialize Candidate Updates accumulator
        const candidateUpdates = {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString(),
            esNuevo: 'NO'
        };

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
        const messagesToProcess = (typeof incomingMessage === 'string' && (incomingMessage.includes(' | ') || incomingMessage.includes('\n')))
            ? incomingMessage.split(/ \| |\n/)
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

        let recentHistory = validMessages
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

        // CRITICAL FIX: Gemini requires first message to be from 'user'
        // If history starts with 'model', remove leading model messages
        while (recentHistory.length > 0 && recentHistory[0].role === 'model') {
            recentHistory.shift();
        }

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
        let project = null;
        let hasMoveTag = false;
        const historyForGpt = [...recentHistory, currentMessageForGpt];

        if (activeProjectId) {
            project = await getProjectById(activeProjectId);
            const currentStep = project?.steps?.find(s => s.id === activeStepId) || project?.steps?.[0];

            // 🎯 Determine active vacancy — always read from project:cand_meta (most up-to-date source)
            let currentIdx = candidateData.currentVacancyIndex !== undefined
                ? candidateData.currentVacancyIndex
                : (candidateData.projectMetadata?.currentVacancyIndex || 0);

            // Override with the authoritative value from project:cand_meta if available
            try {
                const redisForIdx = getRedisClient();
                if (redisForIdx) {
                    const metaRaw = await redisForIdx.hget(`project:cand_meta:${activeProjectId}`, candidateId);
                    if (metaRaw) {
                        const meta = JSON.parse(metaRaw);
                        if (meta.currentVacancyIndex !== undefined) {
                            currentIdx = meta.currentVacancyIndex;
                        }
                    }
                }
            } catch (_) { }

            let activeVacancyId = null;
            if (project?.vacancyIds && project.vacancyIds.length > 0) {
                activeVacancyId = project.vacancyIds[Math.min(currentIdx, project.vacancyIds.length - 1)];
                console.log(`[FAQ] activeVacancyId resolved: index=${currentIdx} → ${activeVacancyId}`);
            } else if (project?.vacancyId) {
                activeVacancyId = project.vacancyId;
            }

            if (currentStep?.aiConfig?.enabled && currentStep.aiConfig.prompt) {
                console.log(`[BIFURCATION] 🚀 Handing off to RECRUITER BRAIN for candidate ${candidateId}`);
                isRecruiterMode = true;
                const activeAiConfig = batchConfig.ai_config ? (typeof batchConfig.ai_config === 'string' ? JSON.parse(batchConfig.ai_config) : batchConfig.ai_config) : {};

                // --- MULTI-VACANCY REJECTION SHIELD ---
                let skipRecruiterInference = false;
                const intent = await classifyIntent(candidateId, aggregatedText, historyForGpt.map(h => h.parts[0].text).join('\n'));

                if ((intent === 'REJECTION' || intent === 'PIVOT') && project.vacancyIds && project.vacancyIds.length > 0) {
                    const isPivot = intent === 'PIVOT';
                    console.log(`[RECRUITER BRAIN] 🛡️ ${isPivot ? 'PIVOT' : 'Rejection'} intent detected for candidate ${candidateId}`);
                    const currentIdx = candidateData.currentVacancyIndex || 0;

                    let reason = "Motivo no especificado";
                    try {
                        const reasonPrompt = `El candidato ha rechazado una vacante. Extrae el motivo principal en máximo 3-4 palabras a partir de este mensaje: "${aggregatedText}". Si no hay motivo claro, responde "No le interesó". Responde solo con el motivo.`;
                        const gptReason = await getOpenAIResponse([], reasonPrompt, 'gpt-4o-mini', activeAiConfig.openaiApiKey);
                        if (gptReason?.content) reason = gptReason.content.replace(/\*/g, '').trim();
                    } catch (e) {
                        console.error("[RECRUITER BRAIN] Could not extract rejection reason:", e);
                    }

                    const currentHist = candidateData.projectMetadata?.historialRechazos || [];
                    const activeVacId = project.vacancyIds[Math.min(currentIdx, project.vacancyIds.length - 1)];

                    if (!isPivot) {
                        // Only log formal rejection, not pivots
                        currentHist.push({ vacancyId: activeVacId, timestamp: new Date().toISOString(), motivo: reason });
                        candidateUpdates.historialRechazos = currentHist;
                        await recordVacancyInteraction(candidateId, project.id, activeVacId, 'REJECTED', reason);
                    }
                    candidateUpdates.currentVacancyIndex = currentIdx + 1;

                    // Fetch next vacancy name for real-time UI updates
                    if (project.vacancyIds[currentIdx + 1]) {
                        const nextVac = await getVacancyById(project.vacancyIds[currentIdx + 1]);
                        if (nextVac) candidateUpdates.currentVacancyName = nextVac.name;
                    }

                    await updateProjectCandidateMeta(project.id, candidateId, {
                        currentVacancyIndex: currentIdx + 1,
                        currentVacancyName: candidateUpdates.currentVacancyName
                    });

                    if (currentIdx + 1 >= project.vacancyIds.length) {
                        console.log(`[RECRUITER BRAIN] 🏁 All vacancies rejected. Moving to Exit Flow.`);
                        // Instead of just silencing, we prepare to fire a move:exit
                        aiResult = {
                            thought_process: "ALL_VACANCIES_REJECTED { move: exit }",
                            response_text: null,
                            close_conversation: true,
                            reaction: '👍'
                        };
                        skipRecruiterInference = true;
                    } else {
                        console.log(`[RECRUITER BRAIN] 🚦 Moving to next vacancy (Index: ${currentIdx + 1}/${project.vacancyIds.length})`);
                    }
                }

                if (!skipRecruiterInference) {
                    const updatedDataForAgent = { ...candidateData, ...candidateUpdates, projectMetadata: { ...candidateData.projectMetadata, currentVacancyIndex: candidateUpdates.currentVacancyIndex !== undefined ? candidateUpdates.currentVacancyIndex : candidateData.projectMetadata?.currentVacancyIndex } };

                    // 🔄 VACANCY TRANSITION CONTEXT: If we just advanced to a new vacancy due to rejection,
                    // replace the rejection message in history with a system note so GPT doesn't
                    // apply the rejection to the NEW vacancy before even presenting it.
                    let historyForRecruiter = historyForGpt;
                    const vacancyJustAdvanced = candidateUpdates.currentVacancyIndex !== undefined
                        && candidateUpdates.currentVacancyIndex > (candidateData.currentVacancyIndex || 0);

                    if (vacancyJustAdvanced) {
                        const newIdx = candidateUpdates.currentVacancyIndex;
                        historyForRecruiter = [
                            ...historyForGpt.slice(0, -1), // Drop the rejection message
                            {
                                role: 'user',
                                parts: [{ text: `[SISTEMA INTERNO]: El candidato rechazó la vacante anterior. Ahora preséntale la siguiente vacante disponible (índice ${newIdx}). Es la primera vez que la ve. NO asumas que la rechaza — apreséntatela con entusiasmo y espera su respuesta.` }]
                            }
                        ];
                        console.log(`[RECRUITER BRAIN] 🔄 Vacancy transition context injected for index ${newIdx}`);
                    }

                    aiResult = await processRecruiterMessage(
                        updatedDataForAgent,
                        project,
                        currentStep,
                        historyForRecruiter,
                        config,
                        activeAiConfig.openaiApiKey,
                        currentIdx  // ✅ authoritative index from project:cand_meta
                    );

                    if (aiResult?.response_text) {
                        // 🧹 Strip any leaked unanswered_question text the AI may have appended to response_text
                        responseTextVal = aiResult.response_text
                            .replace(/\n?unanswered_question:\s*.+/gi, '')
                            .replace(/\n?\"unanswered_question\":\s*\".+\"/gi, '')
                            .trim();
                        aiResult.response_text = responseTextVal;
                    }

                    // 🧠 EXTRACTION SYNC (RECRUITER MODE)
                    // If OpenAI extracted data during a project step, merge it.
                    if (aiResult?.extracted_data) {
                        const { categoria, municipio, escolaridad } = aiResult.extracted_data;
                        if (categoria) candidateUpdates.categoria = categoria;
                        if (municipio) candidateUpdates.municipio = municipio;
                        if (escolaridad) candidateUpdates.escolaridad = escolaridad;
                        console.log(`[RECRUITER BRAIN] 🧬 Extracted data merged:`, aiResult.extracted_data);
                    }

                    const rawUQ = aiResult?.unanswered_question;
                    const unansweredQ = rawUQ && rawUQ !== 'null' && rawUQ !== 'undefined' && String(rawUQ).trim().length > 3
                        ? String(rawUQ).trim() : null;

                    // 🔄 RECALCULATE activeVacancyId: if we just rotated to a new vacancy this turn,
                    // use the NEW index so questions are filed under the correct vacancy
                    if (candidateUpdates.currentVacancyIndex !== undefined && project?.vacancyIds?.length > 0) {
                        const updatedIdx = candidateUpdates.currentVacancyIndex;
                        const safeUpdatedIdx = Math.min(updatedIdx, project.vacancyIds.length - 1);
                        activeVacancyId = project.vacancyIds[safeUpdatedIdx];
                        console.log(`[FAQ Engine] 🔄 activeVacancyId recalculated to index ${updatedIdx}: ${activeVacancyId}`);
                    }

                    // 🎯 FAQ RADAR: Save to FAQ engine regardless — unanswered OR answered
                    const geminiKey = apiKey || activeAiConfig.geminiApiKey || process.env.GEMINI_API_KEY;
                    if (activeVacancyId && geminiKey) {
                        if (unansweredQ) {
                            // Question has no answer — save as unanswered
                            console.log(`[FAQ Engine] 📡 Capturing UNANSWERED: "${unansweredQ}" → vacancy ${activeVacancyId}`);
                            await recordAITelemetry(candidateId, 'faq_detected', { vacancyId: activeVacancyId, question: unansweredQ });
                            processUnansweredQuestion(activeVacancyId, unansweredQ, responseTextVal, geminiKey)
                                .then(() => console.log(`[FAQ Engine] ✅ Unanswered question saved`))
                                .catch(e => console.error('[FAQ Engine] ❌ Cluster Error (unanswered):', e));
                        } else {
                            // Question was answered — detect if user asked something and save it
                            const lastUserMsg = historyForGpt.filter(h => h.role === 'user').slice(-1)[0];
                            const userText = lastUserMsg?.parts?.[0]?.text || '';
                            const questionPatterns = /[?¿]|cuál|cómo|cuánto|cuándo|dónde|qué|quién|hacen|tienen|hay|incluye|es|son|dan|pagan|trabaj|horario|sueldo|salario|uniforme|transporte|beneficio|requisito|antidop/i;
                            const isQuestion = questionPatterns.test(userText) && userText.length > 5;
                            if (isQuestion && responseTextVal) {
                                console.log(`[FAQ Engine] 📝 Recording ANSWERED question: "${userText}"`);
                                processUnansweredQuestion(activeVacancyId, userText, responseTextVal, geminiKey)
                                    .then(() => console.log(`[FAQ Engine] ✅ Answered question saved to FAQ log`))
                                    .catch(e => console.error('[FAQ Engine] ❌ Cluster Error (answered):', e));
                            } else {
                                console.log(`[FAQ Engine] ⏭️ Not a question or no response, skipping FAQ log`);
                            }
                        }
                    } else {
                        console.warn(`[FAQ Engine] ⚠️ Skipped — missing vacancyId(${activeVacancyId}) or geminiKey`);
                    }
                }

                // ⚡ ROBUST MOVE TAG DETECTION
                const moveRegex = /[\{\[]\s*move\s*[\}\]]/i;
                const exitRegex = /[\{\[]\s*move:\s*(exit|no_interesa)\s*[\}\]]/i;

                let hasMoveTag = moveRegex.test(aiResult?.thought_process || '') || moveRegex.test(aiResult?.response_text || '');
                const hasExitTag = exitRegex.test(aiResult?.thought_process || '') || exitRegex.test(aiResult?.response_text || '');

                // 🛡️ CONTEXTUAL SAFETY TRIGGER (MARK STYLE)
                // If Brenda forgets the tag but the developer-certified intent is ACCEPTANCE 
                // AND the bot just asked to schedule, we force the move.
                if (!hasMoveTag && intent === 'ACCEPTANCE') {
                    const lastBotMsg = historyForGpt.filter(h => h.role === 'model').slice(-1)[0];
                    const botText = (lastBotMsg?.parts?.[0]?.text || '').toLowerCase();
                    const isInterviewInvite = botText.includes('agendar tu entrevista') ||
                        botText.includes('agendamos tu entrevista') ||
                        botText.includes('te queda bien');

                    if (isInterviewInvite) {
                        console.log(`[RECRUITER BRAIN] 🛡️ Contextual Acceptance detected (Bot invited, User said Yes)! Forcing { move }.`);
                        hasMoveTag = true;
                    }
                }

                if (hasMoveTag || hasExitTag) {
                    let currentIndex = project.steps.findIndex(s => s.id === activeStepId);
                    if (currentIndex === -1) currentIndex = 0;

                    let nextStep = null;
                    let isExitMove = false;

                    if (hasExitTag) {
                        nextStep = project.steps.find(s =>
                            s.name?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes('no interesa')
                        );
                        isExitMove = true;
                    } else {
                        nextStep = project.steps[currentIndex + 1];
                    }

                    if (nextStep) {
                        console.log(`[RECRUITER BRAIN] 🚀 Moving to step: ${nextStep.name} (Exit: ${isExitMove})`);
                        const recruiterFinalSpeech = responseTextVal;
                        responseTextVal = null;

                        await moveCandidateStep(activeProjectId, candidateId, nextStep.id);
                        candidateUpdates.stepId = nextStep.id;
                        candidateUpdates.projectId = activeProjectId; // Keep them in project

                        // 🔄 SEQUENTIAL: sticker first, then chained AI
                        // Running in parallel risks Vercel serverless killing chainedAI before OpenAI responds
                        try {
                            const redis = getRedisClient();
                            const stepNameLower = isExitMove ? 'exit' : (currentStep?.name?.toLowerCase().trim().replace(/\s+/g, '_'));
                            const specificKeys = [];
                            if (isExitMove) specificKeys.push('bot_bridge_exit', 'bot_bridge_no_interesa');
                            if (stepNameLower && !isExitMove) specificKeys.push(`bot_bridge_${stepNameLower}`);
                            if (!isExitMove) specificKeys.push(`bot_bridge_${activeStepId}`, 'bot_step_move_sticker');

                            let bridgeKey = null;
                            for (const key of specificKeys) {
                                if (await redis?.exists(key)) { bridgeKey = key; break; }
                            }

                            if (bridgeKey) {
                                const bridgeSticker = await redis?.get(bridgeKey);
                                if (bridgeSticker) {
                                    await new Promise(r => setTimeout(r, 800));
                                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, bridgeSticker, 'sticker');
                                }
                            } else {
                                console.log(`[RECRUITER BRAIN] Bridge: No sticker for ${isExitMove ? 'exit' : stepNameLower}, skipping.`);
                            }
                        } catch (e) { console.error(`[RECRUITER BRAIN] Bridge Fail:`, e.message); }

                        // Now trigger next step's AI
                        if (nextStep.aiConfig?.enabled && nextStep.aiConfig.prompt) {
                            try {
                                // 🧹 CLEAN HISTORY for the new step to prevent acceptance leakage from previous step
                                const historyForNextStep = [
                                    ...historyForGpt.filter(h => h.role === 'user').slice(-3), // Keep some context but limited
                                    { role: 'user', parts: [{ text: `[SISTEMA]: El candidato acaba de avanzar al paso "${nextStep.name}". Este es tu primer contacto en este paso. Sigue tu OBJETIVO DE PASO.` }] }
                                ];
                                if (recruiterFinalSpeech) historyForNextStep.splice(-1, 0, { role: 'model', parts: [{ text: recruiterFinalSpeech }] });

                                const nextAiResult = await processRecruiterMessage(
                                    { ...candidateData, ...candidateUpdates },
                                    project, nextStep, historyForNextStep, config,
                                    activeAiConfig.openaiApiKey,
                                    candidateUpdates.currentVacancyIndex !== undefined ? candidateUpdates.currentVacancyIndex : currentIdx
                                );

                                if (nextAiResult?.response_text) {
                                    await new Promise(r => setTimeout(r, 800));
                                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, nextAiResult.response_text);
                                    await saveMessage(candidateId, { from: 'bot', content: nextAiResult.response_text, timestamp: new Date().toISOString() });
                                    console.log(`[RECRUITER BRAIN] ✅ Chained AI sent for step: ${nextStep.name}`);
                                } else {
                                    console.warn(`[RECRUITER BRAIN] ⚠️ Chained AI returned no response_text for step: ${nextStep.name}`);
                                }
                            } catch (e) { console.error(`[RECRUITER BRAIN] Chain Fail:`, e.message); }
                        } else {
                            console.log(`[RECRUITER BRAIN] Next step '${nextStep.name}' has no aiConfig enabled — skipping chained AI.`);
                        }
                    }
                }
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
            // 🛡️ CONTEXT GUARD: Never re-introduce if profile is complete, even if 'new' flag persisted.
            if (isNewFlag && !isProfileComplete) {
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

            // Show Gemini its own previous responses in full — let it decide what's repetitive
            const lastBotMsgsForPrompt = lastBotMessages.slice(-4);
            systemInstruction += `\n[TUS RESPUESTAS ANTERIORES - LEE ESTO CON ATENCIÓN]:\n${lastBotMsgsForPrompt.length > 0 ? lastBotMsgsForPrompt.map((m, i) => `${i + 1}. "${m}"`).join('\n') : '(Primera interacción)'}\n⚠️ REGLA DE ORIGINALIDAD: Tu próxima respuesta debe sonar COMPLETAMENTE DIFERENTE a cualquiera de las anteriores. No repitas la misma apertura, el mismo tono de broma, ni la misma estructura de frase. Si sientes que tu respuesta se parece a alguna de las anteriores, reescríbela desde cero con otro enfoque. \n`;

            systemInstruction += `\n[REGLAS DE EXTRACCIÓN ESTRICTA PARA JSON]:
- tieneEmpleo: DEBE ser uno de estos valores exactos: "Empleado" o "Desempleado". Si el usuario indica que trabaja o tiene "chamba", pon "Empleado". Si indica que está buscando, no tiene trabajo o está libre, pon "Desempleado".
- escolaridad: DEBE ser uno de estos valores exactos: "Primaria", "Secundaria", "Preparatoria", "Carrera Técnica", "Licenciatura", "Ingeniería". Si dice "secu", pon "Secundaria". Si dice "prepa", pon "Preparatoria".
- categoria: DEBE coincidir con alguna palabra de las opciones presentadas al candidato. Si dice "Ayudante", pon "Ayudante General".
- municipio: Usa tu comprensión del español y del contexto mexicano. Si el candidato de cualquier forma implica dónde vive — ya sea directamente ("Escobedo", "Monterrey"), en una frase ("Vivo en Escobedo", "Soy de Apodaca", "Del otro lado de Monterrey") o con rodeos — extrae la localidad. No esperes un formato específico. Confía en tu entendimiento del idioma.
- nombreReal: Si el candidato da solo su nombre de pila sin apellido (ej. solo "Oscar", solo "Juan"), NO guardes el dato todavía. Pídele explícitamente sus apellidos antes de continuar con el siguiente campo.
`;

            systemInstruction += `\n[FORMATO DE RESPUESTA - OBLIGATORIO JSON]: Tu salida DEBE ser un JSON válido con este esquema:
            {
                "extracted_data": { "nombreReal": "string | null", "genero": "Hombre | Mujer | null", "fechaNacimiento": "string | null", "municipio": "string | null", "categoria": "string | null", "tieneEmpleo": "Empleado | Desempleado | null", "escolaridad": "string | null", "edad": "number | null" },
                "thought_process": "Razonamiento.",
                    "reaction": "null",
                        "trigger_media": "string | null",
                            "response_text": "Tu respuesta.",
                                "gratitude_reached": "boolean",
                                    "close_conversation": "boolean"
            }
\n[REGLA ANTI - SILENCIO]: Si el usuario responde con simples confirmaciones("Si", "Claro", "Ok") a una pregunta de datos, TU RESPUESTA DEBE SER:
1. Agradecer / Confirmar("¡Perfecto!", "¡Excelente!").
2. VOLVER A PEDIR EL DATO FALTANTE EXPLICÍTAMENTE.
3. JAMÁS DEJES "response_text" VACÍO si faltan datos.
`;

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: "gemini-2.0-flash",
                systemInstruction,
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.8  // Balanced creativity for natural conversation during extraction
                }
            });
            const chat = model.startChat({ history: recentHistory });
            const result = await chat.sendMessage(userParts);
            const textResult = result.response.text();
            try {
                const sanitized = textResult.replace(/```json | ```/g, '').trim();
                aiResult = JSON.parse(sanitized);
                responseTextVal = aiResult.response_text;

                // 🚨 ENHANCED SILENCE SAFEGUARD V2 🚨
                // Prevents Brenda from going silent under ANY circumstance when profile is incomplete
                const hasEmptyResponse = !responseTextVal || responseTextVal.trim() === '' || responseTextVal === 'null' || responseTextVal === 'undefined';

                // Merge extracted data to check current status
                const mergedStatus = { ...candidateData, ...aiResult.extracted_data };
                const currentAudit = auditProfile(mergedStatus, customFields);
                const isNowComplete = currentAudit.paso1Status === 'COMPLETO';

                // CRITICAL: Activate safeguard if response is empty AND profile is still incomplete
                if (hasEmptyResponse && !isNowComplete) {
                    console.warn(`[SILENCE SAFEGUARD V2] 🚨 Empty response detected for incomplete profile.`);
                    console.warn(`[SILENCE SAFEGUARD V2] Missing fields: ${audit.missingLabels.join(', ')}`);
                    console.warn(`[SILENCE SAFEGUARD V2] User input: "${aggregatedText}"`);
                    console.warn(`[SILENCE SAFEGUARD V2] AI close_conversation flag: ${aiResult.close_conversation}`);

                    // 🧠 INTELLIGENT FIELD SELECTION
                    // Re-audit WITH the extracted data to see what is REALLY still missing
                    const mergedForSafeguard = { ...candidateData, ...aiResult.extracted_data };
                    const freshAudit = auditProfile(mergedForSafeguard, customFields);

                    let nextMissing = 'datos';

                    if (freshAudit.missingLabels.length > 0) {
                        // Strategy: Look at the last bot message to see what we were asking for
                        const lastBotMsg = validMessages.filter(m => m.from === 'bot').slice(-1)[0];
                        const lastBotText = lastBotMsg?.content?.toLowerCase() || '';

                        // Field detection patterns
                        const fieldPatterns = {
                            'Nombre Real': ['nombre completo', 'apellidos', 'apellido', 'nombre real', 'cómo te llamas'],
                            'Género': ['género', 'genero', 'hombre o mujer', 'masculino o femenino', 'sexo'],
                            'Municipio': ['municipio', 'dónde vives', 'donde vives', 'ciudad', 'resides', 'ubicación', 'de donde eres'],
                            'Fecha de Nacimiento': ['fecha de nacimiento', 'fecha nacimiento', 'cuándo naciste', 'cuando naciste', 'edad', 'años tienes', 'cumpleaños'],
                            'Categoría': ['categoría', 'categoria', 'área', 'area', 'puesto', 'trabajo', 'opciones', 'vacantes', 'te interesa'],
                            'Empleo': ['empleo', 'trabajas', 'trabajo actual', 'tienes empleo', 'actualmente tienes empleo', 'laborando'],
                            'Escolaridad': ['escolaridad', 'estudios', 'nivel de estudios', 'nivel de escolaridad', 'educación', 'grado escolar']
                        };

                        // Try to detect what we were asking for
                        let detectedField = null;
                        for (const [fieldLabel, patterns] of Object.entries(fieldPatterns)) {
                            if (patterns.some(pattern => lastBotText.includes(pattern))) {
                                detectedField = fieldLabel;
                                break;
                            }
                        }

                        // If detected field is still missing, use it
                        if (detectedField && audit.missingLabels.includes(detectedField)) {
                            nextMissing = detectedField;
                            console.log(`[SILENCE SAFEGUARD V2] 🎯 Detected we were asking for: ${nextMissing}`);
                        } else {
                            // Fallback: Use first missing field in sequential order
                            nextMissing = audit.missingLabels[0];
                            console.log(`[SILENCE SAFEGUARD V2] 📋 Using first missing field: ${nextMissing}`);
                        }
                    }

                    // 🕵️ INTERRUPTION DETECTION
                    const interruptionKeywords = ['cuanto', 'cuánto', 'donde', 'dónde', 'que', 'qué', 'como', 'cómo', 'pagan', 'sueldo', 'ubicacion', 'ubicación', 'horario', 'prestaciones'];
                    const isInterruption = interruptionKeywords.some(kw => aggregatedText.toLowerCase().includes(kw));

                    // Category-specific fallback with list
                    if (nextMissing === 'Categoría' && categoriesList) {
                        const categoryArray = categoriesList.split(', ').map(c => `✅ ${c} `).join('\n');

                        let intros = [];
                        if (isInterruption) {
                            intros = [
                                '¡Esa es una excelente pregunta! 💡 En un momento te doy todos los detalles, pero primero',
                                '¡Entiendo tu duda! 😉 Ahorita te cuento todo, solo ayúdame primero',
                                '¡Claro! Enseguida te digo, pero antes necesito que elijas una opción'
                            ];
                        } else {
                            // Standard "Distracted" intros
                            intros = [
                                '¡Ay! Me distraje un momento. 😅',
                                '¡Ups! Se me fue el hilo. 🙈',
                                'Perdón, me perdí un segundo. 😊',
                                '¡Uy! Me despiste. 😅',
                                'Disculpa, me desconcentré. 🙈'
                            ];
                        }
                        const randomIntro = intros[Math.floor(Math.random() * intros.length)];

                        aiResult.response_text = `${randomIntro} ¿En qué área te gustaría trabajar ? Estas son las opciones: \n${categoryArray} \n¿Cuál eliges ? 😊`;
                        aiResult.thought_process = isInterruption ? "SAFEGUARD: Interruption detected (Category phase)" : "SAFEGUARD: Categoría no capturada, re-listando opciones.";
                    } else {
                        // Generic fallback for other fields
                        let phrases = [];

                        if (isInterruption) {
                            phrases = [
                                `¡Buena pregunta! 💡 En un segundito te digo, pero antes ayúdame con tu ${nextMissing} para ver qué opciones te tocan. 😉`,
                                `¡Entendido! 👌 Ahorita revisamos eso, pero primero necesito tu ${nextMissing} para registrarte. 😊`,
                                `¡Claro! En un momento te comparto esa info. 😉 ¿Me podrías decir tu ${nextMissing} mientras ? `
                            ];
                        } else {
                            // Standard "Distracted" phrases
                            phrases = [
                                `¡Perdón! Me distraje un momento. 😅 ¿Me podrías decir tu ${nextMissing}, por favor ? `,
                                `¡Ups! Se me fue el hilo. 🙈 ¿Cuál es tu ${nextMissing}?`,
                                `Disculpa, me despiste. 😊 ¿Me repites tu ${nextMissing}, por favor ? `,
                                `¡Ay! Me desconcentré. 😅 ¿Me podrías compartir tu ${nextMissing}?`,
                                `Perdón, me perdí un segundo. 🙈 ¿Cuál es tu ${nextMissing}?`
                            ];
                        }

                        aiResult.response_text = phrases[Math.floor(Math.random() * phrases.length)];
                        aiResult.thought_process = isInterruption ? `SAFEGUARD: Interruption detected(${nextMissing})` : `SAFEGUARD: ${nextMissing} no capturado.`;
                    }
                } else if (hasEmptyResponse && isNowComplete) {
                    // Profile is complete but AI went silent - send transition message
                    console.log(`[SILENCE SAFEGUARD V2] 🏁 Profile completed but AI silent.Injecting transition.`);
                    aiResult.response_text = "¡Perfecto! ✨ Ya tengo todos tus datos. En un momento te cuento más. 😉";
                    aiResult.thought_process = "SAFEGUARD: Profile complete but AI went silent.";
                    aiResult.close_conversation = false;
                }

                responseTextVal = aiResult.response_text;
                console.log(`[SILENCE SAFEGUARD V2] ✅ Injected fallback: "${responseTextVal.substring(0, 50)}..."`);
            } catch (e) {
                console.error(`[Gemini JSON Parse Error] ❌`, e);
                console.error(`[Gemini JSON Parse Error] Raw response: ${textResult?.substring(0, 200)} `);

                // Enhanced fallback for JSON parse error
                if (!isProfileComplete) {

                    // 🧠 INTELLIGENT FIELD SELECTION (Copy of main safeguard)
                    let nextMissing = 'datos';
                    if (audit.missingLabels.length > 0) {
                        // Strategy: Look at the last bot message to see what we were asking for
                        const lastBotMsg = validMessages.filter(m => m.from === 'bot').slice(-1)[0];
                        const lastBotText = lastBotMsg?.content?.toLowerCase() || '';

                        // Field detection patterns
                        const fieldPatterns = {
                            'Nombre Real': ['nombre completo', 'apellidos', 'apellido', 'nombre real', 'cómo te llamas'],
                            'Género': ['género', 'genero', 'hombre o mujer', 'masculino o femenino', 'sexo'],
                            'Municipio': ['municipio', 'dónde vives', 'donde vives', 'ciudad', 'resides', 'ubicación', 'de donde eres'],
                            'Fecha de Nacimiento': ['fecha de nacimiento', 'fecha nacimiento', 'cuándo naciste', 'cuando naciste', 'edad', 'años tienes', 'cumpleaños'],
                            'Categoría': ['categoría', 'categoria', 'área', 'area', 'puesto', 'trabajo', 'opciones', 'vacantes', 'te interesa'],
                            'Empleo': ['empleo', 'trabajas', 'trabajo actual', 'tienes empleo', 'actualmente tienes empleo', 'laborando'],
                            'Escolaridad': ['escolaridad', 'estudios', 'nivel de estudios', 'nivel de escolaridad', 'educación', 'grado escolar']
                        };

                        let detectedField = null;
                        for (const [fieldLabel, patterns] of Object.entries(fieldPatterns)) {
                            if (patterns.some(pattern => lastBotText.includes(pattern))) {
                                detectedField = fieldLabel;
                                break;
                            }
                        }

                        // If detected field is still missing, use it
                        if (detectedField && audit.missingLabels.includes(detectedField)) {
                            nextMissing = detectedField;
                        } else {
                            nextMissing = audit.missingLabels[0];
                        }
                    }

                    // 🕵️ INTERRUPTION DETECTION
                    const interruptionKeywords = ['cuanto', 'cuánto', 'donde', 'dónde', 'que', 'qué', 'como', 'cómo', 'pagan', 'sueldo', 'ubicacion', 'ubicación', 'horario', 'prestaciones'];
                    const isInterruption = interruptionKeywords.some(kw => aggregatedText.toLowerCase().includes(kw));

                    if (nextMissing === 'Categoría' && categoriesList) {
                        const categoryArray = categoriesList.split(', ').map(c => `✅ ${c} `).join('\n');

                        let intros = [];
                        if (isInterruption) {
                            intros = [
                                '¡Esa es una excelente pregunta! 💡 En un momento te doy todos los detalles, pero primero',
                                '¡Entiendo tu duda! 😉 Ahorita te cuento todo, solo ayúdame primero',
                                '¡Claro! Enseguida te digo, pero antes necesito que elijas una opción'
                            ];
                        } else {
                            intros = [
                                '¡Ay! Me distraje un momento. 😅',
                                '¡Ups! Se me fue el hilo. 🙈',
                                'Perdón, me perdí un segundo. 😊',
                                '¡Uy! Me despiste. 😅',
                                'Disculpa, me desconcentré. 🙈'
                            ];
                        }
                        const randomIntro = intros[Math.floor(Math.random() * intros.length)];
                        responseTextVal = `${randomIntro} ¿En qué área te gustaría trabajar ?\n${categoryArray} `;
                    } else {
                        let phrases = [];
                        if (isInterruption) {
                            phrases = [
                                `¡Buena pregunta! 💡 En un segundito te digo, pero antes ayúdame con tu ${nextMissing} para ver qué opciones te tocan. 😉`,
                                `¡Entendido! 👌 Ahorita revisamos eso, pero primero necesito tu ${nextMissing} para registrarte. 😊`,
                                `¡Claro! En un momento te comparto esa info. 😉 ¿Me podrías decir tu ${nextMissing} mientras ? `
                            ];
                        } else {
                            phrases = [
                                `¡Perdón! Me distraje un momento. 😅 ¿Me podrías decir tu ${nextMissing}, por favor ? `,
                                `¡Ups! Se me fue el hilo. 🙈 ¿Cuál es tu ${nextMissing}?`,
                                `Disculpa, me despiste. 😊 ¿Me repites tu ${nextMissing}, por favor ? `,
                                `¡Ay! Me desconcentré. 😅 ¿Me podrías compartir tu ${nextMissing}?`,
                                `Perdón, me perdí un segundo. 🙈 ¿Cuál es tu ${nextMissing}?`
                            ];
                        }
                        responseTextVal = phrases[Math.floor(Math.random() * phrases.length)];
                    }

                    // Create minimal aiResult for downstream processing
                    aiResult = {
                        response_text: responseTextVal,
                        thought_process: "SAFEGUARD: JSON parse error recovery",
                        extracted_data: {},
                        reaction: null,
                        close_conversation: false,
                        gratitude_reached: false
                    };

                    console.log(`[Gemini JSON Parse Error] ✅ Fallback injected: "${responseTextVal.substring(0, 50)}..."`);
                }
            }
        }

        // --- FINAL CONSOLIDATION (Merged with initial candidateUpdates) ---
        // Fields like lastBotMessageAt are already there
        candidateUpdates.bridge_counter = (typeof candidateData.bridge_counter === 'number') ? candidateData.bridge_counter : 0;

        if (aiResult?.extracted_data) {
            Object.entries(aiResult.extracted_data).forEach(([key, val]) => {
                if (val && val !== 'null' && candidateData[key] !== val) {
                    let cleanedVal = val;
                    if (key === 'tieneEmpleo' && typeof val === 'string') {
                        const low = val.toLowerCase().trim();
                        if (low === 'si' || low === 'sí') cleanedVal = 'Sí';
                        else if (low === 'no') cleanedVal = 'No';
                    }
                    candidateUpdates[key] = cleanedVal;
                }
            });
        }

        // 🧠 INTELLIGENT GENDER INFERENCE (FALLBACK)
        const currentGender = candidateUpdates.genero || candidateData.genero;
        if (!currentGender || currentGender === 'desconocido' || currentGender === 'null') {
            const nameToUse = candidateUpdates.nombreReal || candidateData.nombreReal || candidateData.nombre;
            if (nameToUse && nameToUse !== 'Desconocido') {
                const inferred = inferGender(nameToUse);
                if (inferred) {
                    candidateUpdates.genero = inferred;
                    console.log(`[Gender Inference] ✅ Inferred "${inferred}" from name "${nameToUse}"`);
                }
            }
        }

        // 📅 DATE NORMALIZATION & VALIDATION
        // Normalize and validate birth date before saving
        if (aiResult?.extracted_data?.fechaNacimiento) {
            const rawDate = aiResult.extracted_data.fechaNacimiento;
            const normalized = normalizeBirthDate(rawDate);

            if (normalized.isValid) {
                candidateUpdates.fechaNacimiento = normalized.date;
                console.log(`[Date Normalization] ✅ "${rawDate}" → "${normalized.date}"`);
            } else {
                // Invalid date format - trigger specific safeguard
                console.warn(`[Date Validation] ❌ Invalid format: "${rawDate}"`);
                delete candidateUpdates.fechaNacimiento; // Don't save invalid date

                // Override response to ask for correct format
                if (!isProfileComplete && audit.missingLabels.includes('Fecha de Nacimiento')) {
                    responseTextVal = `¡Uy! Necesito la fecha en formato completo, por ejemplo: 19 /05 / 1988(día / mes / año completo) 😊`;
                    aiResult.response_text = responseTextVal;
                    aiResult.thought_process = "SAFEGUARD: Invalid date format detected.";
                    console.log(`[Date Validation] ✅ Injected format correction message`);
                }
            }
        }

        // 🧠 AGE CALCULATOR (Deterministic Math > AI Hallucination)
        const dobToUse = candidateUpdates.fechaNacimiento || candidateData.fechaNacimiento;
        if (dobToUse && /^\d{2}\/\d{2}\/\d{4}$/.test(dobToUse)) {
            try {
                const [d, m, y] = dobToUse.split('/').map(Number);
                const birthDate = new Date(y, m - 1, d);
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const mo = today.getMonth() - birthDate.getMonth();
                if (mo < 0 || (mo === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                if (age > 10 && age < 100) candidateUpdates.edad = age; // Sanity check
            } catch (e) { }
        }

        const finalMerged = { ...candidateData, ...candidateUpdates };
        const finalAudit = auditProfile(finalMerged, customFields);
        const isNowComplete = finalAudit.paso1Status === 'COMPLETO';

        // 🔀 BYPASS SYSTEM - Automatic Project Routing
        const isBypassEnabled = batchConfig.bypass_enabled === 'true';
        const currentStepName = (project?.steps?.find(s => s.id === (candidateUpdates.stepId || activeStepId))?.name || '')
            .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const isInWaitingRoom = currentStepName.includes('no interesa');

        // Trigger if: Profile complete AND (No project OR Stationed in Waiting Room)
        if (isNowComplete && isBypassEnabled && (!candidateData.projectId || isInWaitingRoom)) {
            console.log(`[BYPASS] 🔍 Starting evaluation for ${candidateId}.Profile is COMPLETE.`);

            // 🕵️‍♂️ DEBUG TRACE OBJECT
            const debugTrace = {
                timestamp: new Date().toISOString(),
                candidateId: candidateId,
                candidateData: {
                    edad: finalMerged.edad,
                    municipio: finalMerged.municipio,
                    categoria: finalMerged.categoria,
                    escolaridad: finalMerged.escolaridad,
                    genero: finalMerged.genero,
                    nombreReal: finalMerged.nombreReal
                },
                rules: [],
                finalResult: 'NO_MATCH'
            };

            try {
                const bypassIds = await redis.zrange('bypass:list', 0, -1);
                if (bypassIds.length > 0) {
                    const rulesRaw = await redis.mget(bypassIds.map(id => `bypass:${id}`));
                    const activeRules = rulesRaw.filter(r => r).map(r => JSON.parse(r)).filter(r => r.active);

                    for (const rule of activeRules) {
                        const { minAge, maxAge, municipios, escolaridades, categories, gender, projectId } = rule;

                        // 🛡️ SAFEQUARD: Ensure criteria are arrays even if missing in Redis keys
                        const safeMun = Array.isArray(municipios) ? municipios : [];
                        const safeEsc = Array.isArray(escolaridades) ? escolaridades : [];
                        const safeCat = Array.isArray(categories) ? categories : [];

                        // Match logic (Case Insensitive & trimmed)
                        const candidateAge = parseInt(finalMerged.edad || 0);
                        const cMun = String(finalMerged.municipio || '').toLowerCase().trim();
                        const cEsc = String(finalMerged.escolaridad || '').toLowerCase().trim();
                        const cGen = String(finalMerged.genero || '').toLowerCase().trim();
                        const cCats = (finalMerged.categoria || '').split(',').map(c => c.toLowerCase().trim());

                        const ageMatch = (!minAge || candidateAge >= parseInt(minAge)) && (!maxAge || candidateAge <= parseInt(maxAge));
                        const genderMatch = (gender === 'Cualquiera' || cGen === String(gender).toLowerCase().trim());

                        // Municipality match (ALLOW PARTIAL MATCH e.g. "Escobedo" matches "General Escobedo")
                        const munMatch = (safeMun.length === 0 || safeMun.some(m => {
                            const rm = String(m).toLowerCase().trim();
                            return rm.includes(cMun) || cMun.includes(rm);
                        }));

                        // Schooling match (ALLOW PARTIAL MATCH e.g. "Secu" matches "Secundaria")
                        const escMatch = (safeEsc.length === 0 || safeEsc.some(e => {
                            const re = String(e).toLowerCase().trim();
                            return re.includes(cEsc) || cEsc.includes(re);
                        }));

                        // Categories match if ANY of the candidate's cats are in the rule ones
                        // ALLOW PARTIAL MATCH (e.g. "Ayudante" matches "Ayudante General")
                        const ruleCatsLow = safeCat.map(c => String(c).toLowerCase().trim());
                        const catMatch = (ruleCatsLow.length === 0 || cCats.some(c =>
                            ruleCatsLow.some(rc => rc.includes(c) || c.includes(rc))
                        ));

                        const isMatch = ageMatch && genderMatch && munMatch && escMatch && catMatch;

                        console.log(`[BYPASS] Rule Check: "${rule.name}" | Match: ${isMatch} | Checks: age:${ageMatch}, mun:${munMatch}, cat:${catMatch}, esc:${escMatch}, gen:${genderMatch}`);

                        // Add to Debug Trace
                        debugTrace.rules.push({
                            ruleName: rule.name,
                            criteria: { minAge, maxAge, municipios, escolaridades, categories, gender },
                            checks: {
                                age: ageMatch,
                                municipio: munMatch,
                                categoria: catMatch,
                                escolaridad: escMatch,
                                genero: genderMatch
                            },
                            isMatch
                        });

                        if (isMatch) {
                            console.log(`[BYPASS] ✅ MATCH FOUND: Rule "${rule.name}" → Project ${projectId}`);

                            // Assign candidate to project
                            const { addCandidateToProject } = await import('../utils/storage.js');
                            await addCandidateToProject(projectId, candidateId);

                            candidateUpdates.projectId = projectId;
                            candidateUpdates.stepId = 'step_default';

                            // 🎯 BYPASS VACANCY NAME: Store first vacancy name for the ADN card
                            try {
                                const proj = await getProjectById(projectId);
                                if (proj?.vacancyIds?.length > 0) {
                                    const firstVac = await getVacancyById(proj.vacancyIds[0]);
                                    if (firstVac) candidateUpdates.currentVacancyName = firstVac.name;
                                }
                            } catch (vErr) {
                                console.error("[BYPASS] Failed to attach vacancy name:", vErr);
                            }

                            debugTrace.finalResult = 'MATCH';
                            debugTrace.matchedRule = rule.name;
                            debugTrace.assignedProject = projectId;

                            console.log(`[BYPASS] 🎯 Candidate ${candidateId} routed to project ${projectId}`);
                            break; // Stop at first match
                        }
                    }
                }

                if (debugTrace.finalResult === 'NO_MATCH') {
                    console.log(`[BYPASS] ❌ No matching rules found for ${candidateId}`);
                }

                // Save debug trace
                await redis.lpush('debug:bypass:traces', JSON.stringify(debugTrace));
                await redis.ltrim('debug:bypass:traces', 0, 49);

            } catch (bypassError) {
                console.error(`[BYPASS] ❌ Error during evaluation: `, bypassError);
            }
        }

        // --- COMPLETION & CELEBRATION LOGIC ---
        if (!isBridgeActive && !isHostMode) {
            if (isNowComplete && aiResult?.gratitude_reached === true) {
                aiResult.reaction = '👍';
            } else if (!aiResult?.reaction && !isRecruiterMode) {
                aiResult.reaction = null;
            }

            // 🚫 MOVE SILENCE: If we moved, don't send a reaction to the old message
            if (hasMoveTag) {
                console.log(`[RECRUITER BRAIN] 🤫 Silencing reaction for move event.`);
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
                // 🎯 BYPASS MATCH: Enter project's first step
                const project = await getProjectById(finalProjectId);
                const currentStep = project?.steps?.find(s => s.id === (candidateUpdates.stepId || activeStepId)) || project?.steps?.[0];
                if (currentStep?.aiConfig?.enabled) {
                    const historyWithCongrats = [...historyForGpt, { role: 'model', parts: [{ text: congratsMsg }] }];
                    const recruiterResult = await processRecruiterMessage({ ...candidateData, ...candidateUpdates }, project, currentStep, historyWithCongrats, config, activeAiConfig.openaiApiKey, currentIdx);
                    if (recruiterResult?.response_text) responseTextVal = recruiterResult.response_text;
                }
            } else {
                // 🏠 NO PROJECT: Enter waiting room
                console.log(`[GPT Host] Candidate ${candidateId} completed profile without project.`);
                candidateUpdates.gratitudAlcanzada = false;
                candidateUpdates.silencioActivo = false;
                responseTextVal = null;
            }
        }

        const updatePromise = updateCandidate(candidateId, candidateUpdates);
        let reactionPromise = Promise.resolve();
        if (msgId && config && aiResult?.reaction) {
            reactionPromise = sendUltraMsgReaction(config.instanceId, config.token, msgId, aiResult.reaction);
        }

        let deliveryPromise = Promise.resolve();
        let resText = String(responseTextVal || '').trim();

        // 🧹 MOVE TAG SANITIZER: Strip internal move tags from outbound messages
        const moveTagPattern = /[\{\[]\s*move(?::\s*(?:exit|no_interesa|\w+))?\s*[\}\]]/gi;
        if (moveTagPattern.test(resText)) {
            resText = resText.replace(moveTagPattern, '').trim();
            responseTextVal = resText || null;
            console.log('[Move Tag Sanitizer] ⚠️ Stripped move tag from outbound message.');
        }

        if (responseTextVal && (!aiResult?.media_url || aiResult.media_url === 'null')) {
            // [MEDIA RECOVERY]: If Brenda leaked the link into text but forgot the JSON field, recover it
            // Matches both /api/image?id=... and /api/media/ID.ext
            const mediaPattern = /https?:\/\/[^/]+\/api\/(image\?id=|media\/)([^\s\)]+)/i;
            const match = responseTextVal.match(mediaPattern);
            if (match) {
                if (!aiResult) aiResult = {};
                aiResult.media_url = match[0];
                console.log(`[Media Recovery] 🚑 Recovered leaked URL from text: ${aiResult.media_url}`);
            }
        }

        if (responseTextVal && aiResult?.media_url && aiResult.media_url !== 'null') {
            // Failsafe: Remove any detected URLs or Markdown images to prevent leakage
            const urlRegex = /https?:\/\/[^\s\)]+/g;
            const markdownImageRegex = /!\[.*?\]\(.*?\)/g;
            responseTextVal = responseTextVal.replace(markdownImageRegex, '').replace(urlRegex, '').replace(/\s+/g, ' ').trim();
            console.log('[Media Sanitizer] 🛡️ Stripped potential URL leakage from response_text.');
        }

        const isTechnical = !resText || ['null', 'undefined', '[SILENCIO]', '[REACCIÓN/SILENCIO]'].includes(resText) || resText.startsWith('[REACCIÓN:');

        if (responseTextVal && !isTechnical) {
            deliveryPromise = (async () => {
                await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseTextVal);
                if (aiResult?.media_url && aiResult.media_url !== 'null') {
                    let mUrl = aiResult.media_url;
                    // Ensure absolute URL for UltraMsg
                    if (mUrl && mUrl.startsWith('/api/')) {
                        mUrl = `https://candidatic-ia.vercel.app${mUrl}`;
                    } else if (mUrl && mUrl.includes('candidatic.ia') && !mUrl.includes('vercel.app')) {
                        // Switch to the technical domain which is more reliable for crawlers
                        mUrl = mUrl.replace('candidatic.ia', 'candidatic-ia.vercel.app');
                    }
                    const mUrlForDetect = mUrl;
                    // Detect if it's a PDF by extension or URL pattern
                    let isPdf = mUrl.toLowerCase().includes('.pdf') || mUrl.includes('mime=application%2Fpdf');

                    // DEEP DETECTION: Query Redis for internal URLs to guarantee document type
                    if (mUrl.includes('/api/image')) {
                        try {
                            const urlObj = new URL(mUrl, 'https://candidatic.ia');
                            const mediaId = urlObj.searchParams.get('id');
                            if (mediaId) {
                                const redis = getRedisClient();
                                if (redis) {
                                    const metaRaw = await redis.get(`meta:image:${mediaId}`);
                                    if (metaRaw) {
                                        const meta = JSON.parse(metaRaw);
                                        if (meta.mime === 'application/pdf') isPdf = true;
                                    }
                                }
                            }
                        } catch (e) { console.warn('[MEDIA DELIVERY] Deep detection failed:', e.message); }
                    }

                    const filename = isPdf ? 'Informacion.pdf' : 'Imagen.jpg';
                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, mUrl, isPdf ? 'document' : 'image', { filename });
                    console.log(`[MEDIA DELIVERY] Sent ${isPdf ? 'PDF' : 'IMAGE'}: ${mUrl}`);
                }
            })();
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

        // 📝 [DEBUG LOG]: Store full trace (Synchronous for Vercel/Serverless reliability)
        try {
            const redisClient = getRedisClient();
            if (redisClient) {
                const trace = {
                    v: "V_FINAL_SYNC_OK",
                    timestamp: new Date().toISOString(),
                    receivedMessage: aggregatedText,
                    intent,
                    apiUsed: isRecruiterMode ? `recruiter - agent(Step: ${activeStepId})` : 'capturista-brain',
                    aiResult,
                    isNowComplete
                };
                await redisClient.lpush(`debug:agent:logs:${candidateId}`, JSON.stringify(trace));
                await redisClient.ltrim(`debug:agent:logs:${candidateId}`, 0, 49);
                await redisClient.set('debug:global:last_run', JSON.stringify({
                    candidateId,
                    timestamp: trace.timestamp,
                    msg: aggregatedText.substring(0, 50),
                    hasUQ: !!aiResult?.unanswered_question
                }), 'EX', 3600);
            }
        } catch (e) {
            console.error(`[DEBUG] Trace failed: `, e.message);
        }

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
