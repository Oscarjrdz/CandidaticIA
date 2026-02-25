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
import { AIGuard } from '../utils/ai-guard.js';
import { Orchestrator } from '../utils/orchestrator.js';
import { MediaEngine } from '../utils/media-engine.js';

export const DEFAULT_EXTRACTION_RULES = `
[EXTRAER]: nombreReal, genero, fechaNacimiento, edad, municipio, categoria, escolaridad, tieneEmpleo.
1. REFINAR: Si el dato en [ESTADO] es incompleto, fusiónalo con el nuevo.
2. FORMATO: Nombres/Municipios en Title Case. Fecha DD/MM/YYYY.
3. ESCOLARIDAD: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, Posgrado.
4. EMPLEO: "Empleado" o "Desempleado".
5. CATEGORÍA: Solo de: {{categorias}}.
`;

export const DEFAULT_CEREBRO1_RULES = `
[CAPTURISTA BRENDA]: Recolecta {{faltantes}}. (Empleo: pregunta si está "Empleado" o "Desempleado").
1. Solo UN dato a la vez. No abrumes.
2. Tono tierno y servicial. ✨
3. No saltes de dato hasta llenar el actual.
4. No aceptes datos basura.
`;

export const DEFAULT_SYSTEM_PROMPT = `
[IDENTIDAD]: Brenda (25), reclutadora de Candidatic. Cálida, tierna, 3 emojis/msg. ✨🌸
1. BREVEDAD: Respuestas cortas. No asteriscos (*).
2. PUENTE: Si < 2h, sé directa. Si > 2h, saluda ("¡Hola de nuevo! ✨").
3. PROTOCOLO: 1er contacto: "¡Hola! Soy Brenda...". 
4. ANTI-HOLA: Si el historial muestra que YA saludaste recientemente, NO repitas saludos ni menciones el nombre del candidato en cada frase. Sé fluida como una charla de WhatsApp.
5. ANTI-REPETICIÓN (PENALIDAD FATAL): Está PROHIBIDO usar las mismas frases o estructuras de [MEMORIA DEL HILO]. Si te repites, fallas en tu misión humana. Cambia palabras, orden y estilo.
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
                year = yy >= 50 ? `19${year} ` : `20${year} `;
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

            return { isValid: true, date: `${day} /${month}/${year} ` };
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

        let intent = 'UNKNOWN';

        // 🛡️ [BLOCK SHIELD]: Force silence if candidate is blocked
        if (candidateData.blocked === true) {
            console.log(`[BLOCK SHIELD] Skipping processMessage for blocked candidate: ${candidateId} `);
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

        console.log(`[DEBUG AGENT ENTRY]Candidate: ${candidateId} | Messages: ${allMessages.length} `);


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
                const ghostKeywords = ['focusada', 'procesa su perfil'];
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
                    content = `[Mensaje de Lic.Brenda - Seguimiento Automático]: ${content} `;
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
- ¿Es Primer Contacto ?: ${isNewFlag && !isProfileComplete ? 'SÍ (Presentarse)' : 'NO (Ya saludaste)'}
- Gratitud Alcanzada: ${currentHasGratitude ? 'SÍ (Ya te dio las gracias)' : 'NO (Aún no te agradece)'}
- Silencio Operativo: ${currentIsSilenced ? 'SÍ (La charla estaba cerrada)' : 'NO (Charla activa)'}
- Inactividad: ${minSinceLastBot} min(${isLongSilence ? 'Regreso fresco' : 'Hilo continuo'})
\n[REGLA CRÍTICA]: SI[PERFIL COMPLETADO] ES SÍ, NO pidas datos proactivamente.Sin embargo, SI el usuario provee información nueva o corrige un dato(ej. "quiero cambiar mi nombre"), PROCÉSALO en extracted_data y confirma el cambio amablemente.`;

        // Use Nitro Cached Config
        const aiConfigJson = batchConfig.ai_config;

        // 🧨 RESET COMMAND (TEMPORARY FOR TESTING)
        if (incomingMessage === 'RESET') {
            if (candidateData && candidateData.whatsapp) {
                const phone = candidateData.whatsapp;
                const id = candidateId;
                await redis.del(`candidatic: candidate:${id} `);
                await redis.hdel('candidatic:phone_index', phone);
                if (config) {
                    await sendUltraMsgMessage(config.instanceId, config.token, phone, "🧨 DATOS BORRADOS. Eres un usuario nuevo. Di 'Hola' para empezar.");
                }
                return 'RESET_DONE';
            }
        }

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos.SI NO SABES EL NOMBRE REAL(Persona), NO LO INVENTES Y PREGÚNTALO.\n`;

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
            .replace('CATEGORÍAS VÁLIDAS: ', `CATEGORÍAS VÁLIDAS: ${categoriesList} `);

        systemInstruction += `\n[ESTADO DEL CANDIDATO]:
- Perfil Completo: ${audit.paso1Status === 'COMPLETO' ? 'SÍ' : 'NO'}
- Nombre Real: ${candidateData.nombreReal || 'No proporcionado'}
- WhatsApp: ${candidateData.whatsapp}
- Municipio: ${candidateData.municipio || 'No proporcionado'}
- Categoría: ${candidateData.categoria || 'No proporcionado'}
${audit.dnaLines}
- Temas recientes: ${themes || 'Nuevo contacto'}
\n[CATEGORÍAS VÁLIDAS EN EL SISTEMA]: ${categoriesList} \n
\n${extractionRules} `;

        let activeProjectId = candidateData.projectId || candidateData.projectMetadata?.projectId;
        let activeStepId = candidateData.stepId || candidateData.projectMetadata?.stepId || 'step_new';

        if (!activeProjectId) {
            const client = getRedisClient();
            activeProjectId = await client.hget('index:cand_project', candidateId);
            if (activeProjectId) {
                const rawMeta = await client.hget(`project: cand_meta:${activeProjectId} `, candidateId);
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
                    const metaRaw = await redisForIdx.hget(`project: cand_meta:${activeProjectId} `, candidateId);
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
                console.log(`[FAQ] activeVacancyId resolved: index = ${currentIdx} → ${activeVacancyId} `);
            } else if (project?.vacancyId) {
                activeVacancyId = project.vacancyId;
            }

            if (currentStep?.aiConfig?.enabled && currentStep.aiConfig.prompt) {
                console.log(`[BIFURCATION] 🚀 Handing off to RECRUITER BRAIN for candidate ${candidateId}`);
                isRecruiterMode = true;
                const activeAiConfig = batchConfig.ai_config ? (typeof batchConfig.ai_config === 'string' ? JSON.parse(batchConfig.ai_config) : batchConfig.ai_config) : {};

                // --- MULTI-VACANCY REJECTION SHIELD ---
                let skipRecruiterInference = false;
                intent = await classifyIntent(candidateId, aggregatedText, historyForGpt.map(h => h.parts[0].text).join('\n'));

                if ((intent === 'REJECTION' || intent === 'PIVOT') && project.vacancyIds && project.vacancyIds.length > 0) {
                    const isPivot = intent === 'PIVOT';
                    console.log(`[RECRUITER BRAIN] 🛡️ ${isPivot ? 'PIVOT' : 'Rejection'} intent detected for candidate ${candidateId}`);
                    const currentIdx = candidateData.currentVacancyIndex || 0;

                    let reason = "Motivo no especificado";
                    try {
                        const reasonPrompt = `El candidato ha rechazado una vacante.Extrae el motivo principal en máximo 3 - 4 palabras a partir de este mensaje: "${aggregatedText}".Si no hay motivo claro, responde "No le interesó".Responde solo con el motivo.`;
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
                        console.log(`[RECRUITER BRAIN] 🏁 All vacancies rejected.Moving to Exit Flow.`);
                        // Instead of just silencing, we prepare to fire a move:exit
                        aiResult = {
                            thought_process: "ALL_VACANCIES_REJECTED { move: exit }",
                            response_text: null,
                            close_conversation: true,
                            reaction: '👍'
                        };
                        skipRecruiterInference = true;
                    } else {
                        console.log(`[RECRUITER BRAIN] 🚦 Moving to next vacancy(Index: ${currentIdx + 1}/${project.vacancyIds.length})`);
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
                                parts: [{ text: `[SISTEMA INTERNO]: El candidato rechazó la vacante anterior.Ahora preséntale la siguiente vacante disponible(índice ${newIdx}).Es la primera vez que la ve.NO asumas que la rechaza — apreséntatela con entusiasmo y espera su respuesta.` }]
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
                        console.log(`[RECRUITER BRAIN] 🧬 Extracted data merged: `, aiResult.extracted_data);
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
                        console.log(`[FAQ Engine] 🔄 activeVacancyId recalculated to index ${updatedIdx}: ${activeVacancyId} `);
                    }

                    // 🎯 FAQ RADAR: Save to FAQ engine regardless — unanswered OR answered
                    const geminiKey = apiKey || activeAiConfig.geminiApiKey || process.env.GEMINI_API_KEY;
                    if (activeVacancyId && geminiKey) {
                        if (unansweredQ) {
                            // Question has no answer — save as unanswered
                            console.log(`[FAQ Engine] 📡 Capturing UNANSWERED: "${unansweredQ}" → vacancy ${activeVacancyId} `);
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
                        console.log(`[RECRUITER BRAIN] 🛡️ Contextual Acceptance detected(Bot invited, User said Yes)! Forcing { move }.`);
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
                            if (stepNameLower && !isExitMove) specificKeys.push(`bot_bridge_${stepNameLower} `);
                            if (!isExitMove) specificKeys.push(`bot_bridge_${activeStepId} `, 'bot_step_move_sticker');

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
                                console.log(`[RECRUITER BRAIN]Bridge: No sticker for ${isExitMove ? 'exit' : stepNameLower}, skipping.`);
                            }
                        } catch (e) { console.error(`[RECRUITER BRAIN] Bridge Fail: `, e.message); }

                        // Now trigger next step's AI
                        if (nextStep.aiConfig?.enabled && nextStep.aiConfig.prompt) {
                            try {
                                // 🧹 CLEAN HISTORY for the new step to prevent acceptance leakage from previous step
                                const historyForNextStep = [
                                    ...historyForGpt.filter(h => h.role === 'user').slice(-3), // Keep some context but limited
                                    { role: 'user', parts: [{ text: `[SISTEMA]: El candidato acaba de avanzar al paso "${nextStep.name}".Este es tu primer contacto en este paso.Sigue tu OBJETIVO DE PASO.` }] }
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
                                    console.log(`[RECRUITER BRAIN] ✅ Chained AI sent for step: ${nextStep.name} `);
                                } else {
                                    console.warn(`[RECRUITER BRAIN] ⚠️ Chained AI returned no response_text for step: ${nextStep.name} `);
                                }
                            } catch (e) { console.error(`[RECRUITER BRAIN] Chain Fail: `, e.message); }
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
            console.log(`[Silence Shield] Active for ${candidateId}.Count: ${bridgeCounter} `);
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
            console.log(`[HANDOVER] 🚀 Handing off to GPT HOST(OpenAI) for candidate ${candidateId}`);
            isHostMode = true;
            try {
                const hostPrompt = activeAiConfig.gptHostPrompt || 'Eres la Lic. Brenda Rodríguez de Candidatic.';
                const gptResponse = await getOpenAIResponse(allMessages, `${hostPrompt} \n[ADN]: ${JSON.stringify(candidateData)} `, activeAiConfig.openaiModel || 'gpt-4o-mini', activeAiConfig.openaiApiKey);

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
            // 🛡️ [IDENTITY & RULES]
            if (isNewFlag && !isProfileComplete) {
                systemInstruction += `\n[MISIÓN ACTUAL: BIENVENIDA]: Es el primer mensaje. Preséntate como la Lic. Brenda y pide el Nombre completo para iniciar el registro. ✨🌸\n`;
            } else if (!isProfileComplete) {
                const cerebro1Rules = (batchConfig.bot_cerebro1_rules || DEFAULT_CEREBRO1_RULES)
                    .replace('{{faltantes}}', audit.missingLabels.join(', '))
                    .replace(/{{categorias}}/g, categoriesList);
                systemInstruction += `\n${cerebro1Rules}\n`;
            } else {
                systemInstruction += !hasGratitude
                    ? `\n[MISIÓN ACTUAL: BUSCAR GRATITUD]: El perfil está completo. Sé súper amable y busca que el usuario te dé las gracias. ✨💅\n`
                    : `\n[MISIÓN ACTUAL: OPERACIÓN SILENCIO]: El usuario ya agradeció. No escribas texto. واکنش 👍 y close_conversation: true. 👋🤫\n`;
            }

            // [ANTI-REPETITION LAYER]
            const lastBotMsgsForPrompt = lastBotMessages.slice(-4);
            systemInstruction += `\n[MEMORIA RECIENTE]: \n${lastBotMsgsForPrompt.length > 0 ? lastBotMsgsForPrompt.map((m, i) => `${i + 1}. "${m}"`).join('\n') : '(Primer contacto)'}\n⚠️ Tu respuesta debe ser TOTALMENTE DIFERENTE a las anteriores.\n`;

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: "gemini-2.0-flash",
                systemInstruction,
                generationConfig: { responseMimeType: "application/json", temperature: 0.8 }
            });

            const chat = model.startChat({ history: recentHistory });
            const result = await chat.sendMessage(userParts);
            const textResult = result.response.text();

            // 🛡️ [AI GUARDRAIL]
            const rawJson = AIGuard.sanitizeJSON(textResult);
            const guardContext = {
                isProfileComplete: audit.paso1Status === 'COMPLETO',
                missingFields: audit.missingLabels,
                lastInput: aggregatedText
            };

            aiResult = AIGuard.validate(rawJson, guardContext);
            responseTextVal = aiResult.response_text;

            // 🧬 [DUAL-STREAM EXTRACTION]
            if (aiResult.extracted_data && Object.keys(aiResult.extracted_data).length > 0) {
                console.log(`[DUAL-STREAM] 🧬 Extracted:`, aiResult.extracted_data);
                Object.assign(candidateUpdates, aiResult.extracted_data);
            }

            // 🔄 [TRANSITION & HANDOVER]
            const currentAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
            const isNowComplete = currentAudit.paso1Status === 'COMPLETO';

            if (await Orchestrator.checkBypass(candidateData, currentAudit)) {
                console.log(`[ORCHESTRATOR] 🚀 Handover Triggered.`);
                const handoverResult = await Orchestrator.executeHandover({ ...candidateData, ...candidateUpdates }, config);
                if (handoverResult?.triggered) {
                    candidateUpdates.projectId = handoverResult.projectId;
                    candidateUpdates.stepId = handoverResult.stepId;
                    responseTextVal = null; // Silence main stream, handover message already sent
                }
            } else if (isNowComplete && !candidateData.congratulated) {
                console.log(`[ORCHESTRATOR] 🛋️ Entering Waiting Room.`);
                responseTextVal = "¡Listo! 🌟 Ya tengo todos tus datos guardados. Pronto un reclutador te contactará. ✨🌸";
                candidateUpdates.congratulated = true;
                await MediaEngine.sendCongratsPack(config, candidateData.whatsapp, 'bot_celebration_sticker');
            }
        }

        // --- REACTION LOGIC ---
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
                console.log(`[Media Recovery] 🚑 Recovered leaked URL from text: ${aiResult.media_url} `);
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

        // 🛡️ [FINAL DELIVERY SAFEGUARD]: If Brenda is about to go silent but profile isn't closed, force a fallback
        if (!responseTextVal && !isTechnical && !aiResult?.close_conversation && !isRecruiterMode) {
            console.warn(`[FINAL SAFEGUARD] 🚨 Attempted silence for candidate ${candidateId}. Forcing fallback.`);
            responseTextVal = "¡Ay! Me distraje un segundo. 😅 ¿Qué me decías?";
        }

        if (responseTextVal && !isTechnical) {
            deliveryPromise = (async () => {
                let mUrl = aiResult?.media_url;
                if (mUrl && mUrl !== 'null') {
                    // Ensure absolute URL for UltraMsg
                    if (mUrl.startsWith('/api/')) {
                        mUrl = `https://candidatic-ia.vercel.app${mUrl}`;
                    } else if (mUrl.includes('candidatic.ia') && !mUrl.includes('vercel.app')) {
                        mUrl = mUrl.replace('candidatic.ia', 'candidatic-ia.vercel.app');
                    }

                    // Detect if it's a PDF
                    let isPdf = mUrl.toLowerCase().includes('.pdf') || mUrl.includes('mime=application%2Fpdf');
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
                    const textPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseTextVal);
                    const mediaPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, mUrl, isPdf ? 'document' : 'image', { filename });

                    await Promise.allSettled([textPromise, mediaPromise]);
                    console.log(`[MEDIA DELIVERY] Sent parallel text + ${isPdf ? 'PDF' : 'IMAGE'}`);
                } else {
                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseTextVal);
                    console.log(`[TEXT DELIVERY] Sent text only: ${candidateId}`);
                }
            })();
        }

        // 📝 [DEBUG LOG]: Store full trace NOW before potential timeouts in secondary deliveries
        try {
            const redisClient = getRedisClient();
            if (redisClient) {
                const trace = {
                    v: "V_FINAL_STABLE_V1",
                    timestamp: new Date().toISOString(),
                    receivedMessage: aggregatedText,
                    intent,
                    apiUsed: isRecruiterMode ? `recruiter-agent(Step: ${activeStepId})` : 'capturista-brain',
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

        await Promise.allSettled([
            deliveryPromise,
            stickerPromise,
            reactionPromise,
            saveMessage(candidateId, {
                from: 'bot',
                content: responseTextVal || (aiResult?.reaction ? `[REACCIÓN: ${aiResult.reaction}]` : '[SILENCIO]'),
                timestamp: new Date().toISOString()
            })
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
