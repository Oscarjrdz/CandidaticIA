// [PREMIUM ARCHITECTURE] V_FINAL_STABLE_V1 - Zero-Silence Infrastructure Active
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
import { intelligentExtract } from '../utils/intelligent-extractor.js';

export const DEFAULT_EXTRACTION_RULES = `
[EXTRAER]: nombreReal, genero, fechaNacimiento, edad, municipio, categoria, escolaridad, tieneEmpleo.
1. REFINAR: Si el dato en [ESTADO] es incompleto, fusiónalo con el nuevo.
2. FORMATO: Nombres/Municipios en Title Case. Fecha DD/MM/YYYY.
3. ESCOLARIDAD: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, Posgrado.
4. EMPLEO: "Empleado" o "Desempleado".
5. CATEGORÍA: Solo de: {{categorias}}.
`;

export const DEFAULT_CEREBRO1_RULES = `
[FASE 1: TU MISIÓN PRINCIPAL - FLUJO DE CAPTURA]
Tu objetivo técnico es obtener: {{faltantes}}.

 REGLAS DE MISIÓN:
 1. AFIRMACIONES Y HALAGOS: Si el usuario dice "Sí", "Claro", "Te ayudo" o te hace un halago, NO lo ignores. Responde con mucha alegría y dulzura (ej: "¡Ay, qué lindo! 🤭✨ me chiveas") y pide el dato inmediatamente.
 2. NOMBRE COMPLETO: Si solo te da el nombre, pídele los apellidos con encanto. No puedes avanzar sin ellos.
 3. CATEGORÍA: Muestra OBLIGATORIAMENTE la lista completa vertical una por una con ✅. No la ocultes.
    ESTRUCTURA OBLIGATORIA:
    "¡Qué alegría! 🌟 Mira, estas son las opciones que tengo para ti 💖: 
    {{categorias}}
    ¿Cuál eliges? 🤭"
 4. FECHA DE NACIMIENTO: Pídela SIEMPRE dando el ejemplo exacto: "(ej: 19/05/1990)". No lo olvides.
 5. DINÁMICA: Si responde algo que no sea el dato (ej: "No vivo ahí", "No sé"), SIEMPRE sé empática primero ("¡Entiendo! ✨", "No hay problema 🌸") y luego re-enfoca pidiendo el dato que falta o el siguiente.
 6. PERSUASIÓN: Si pregunta por vacantes o sueldos, dile que necesitas sus datos para que el sistema le asigne la mejor opción y continúa con: {{faltantes}}.
 7. LENGUAJE: PROHIBIDO decir "base de datos". Di "nuestro sistema" o "tu registro".
 8. CORTESÍA: Si te saluda, salúdalo de vuelta con un emoji variado antes de pedir el dato.
`;

export const DEFAULT_SYSTEM_PROMPT = `
[PERSONALIDAD]:
Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
Eres carismática, profesional, coqueta y muy divertida. 
Hablas como una joven de oficina que usa su encanto para que los candidatos se sientan en confianza.
Usa emojis para hacerlo agradable y tierno, no uses los mismos siempre. No uses asteriscos (*).

[REGLAS DE ORO]:
- NUNCA REPITAS MENSAJES. Sé creativa, varía tus palabras.
- Si preguntan por vacantes/sueldos: Explica que necesitas sus datos para que el sistema le asigne lo mejor. Mantén la expectativa alta (ej: "estoy revisando zonas", "validando turnos").
- Si te ligan o halagan: Responde con picardía, gracia y mucha dulzura (ej: "¡Ay, qué lindo! 🤭✨ me chiveas"), pero re-enfoca a la extracción inmediatamente para no perder el tiempo.
- MENSAJES CORTOS: Máximo 4 líneas.

[PROTOCOLO DE SALUDO (ALEATORIO)]:
Usa frases como: "¡Hola! 👋 Qué gusto saludarte", "¡Hola, hola! 👋 Soy la Lic. Brenda", "¡Qué tal! Por aquí la Lic. Brenda", "¡Mucho gusto! ✨". Varía siempre.

[REGLAS DE FORMATO]:
- PROHIBIDO USAR ASTERISCOS (*).
- No uses "Hola" en segundos mensajes, solo en el inicial.
- No hagas halagos personales (guapo, lindo, etc.).
- LISTAS VERTICALES: Categorías siempre una por renglón con ✅.
- FECHAS: Siempre usa el ejemplo (19/05/1990).
- NO digas "base de datos", di "tu registro" o "nuestro sistema".

[REGLA DE ADN]: Confía en [ESTADO DEL CANDIDATO(ADN)] como verdad absoluta.
`;

export const DEFAULT_ASSISTANT_PROMPT = `
Eres la Lic. Brenda Rodríguez de Candidatic. 
Puntualmente asistes a los reclutadores para resolver dudas de candidatos.
Sé amable, eficiente y profesional.
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
        /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/,
        // DD/MM/YY (2-digit year)
        /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/,
    ];

    for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match) {
            let [, day, month, year] = match;

            // Convert 2-digit year to 4-digit
            if (year.length === 2) {
                const yy = parseInt(year);
                year = yy >= 40 ? `19${year}` : `20${year}`;
            }

            // Pad day and month with leading zeros
            day = day.padStart(2, '0');
            month = month.padStart(2, '0');

            const d = parseInt(day);
            const m = parseInt(month);
            const y = parseInt(year);

            // Basic Range Validation
            if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > new Date().getFullYear()) {
                return { isValid: false, date: null };
            }

            // Correctness check (Leap Year/Days in month)
            const testDate = new Date(y, m - 1, d);
            if (testDate.getDate() !== d || testDate.getMonth() !== m - 1) {
                return { isValid: false, date: null };
            }

            return { isValid: true, date: `${day}/${month}/${year}` };
        }
    }

    return { isValid: false, date: null };
}

/**
 * 🧬 COALESCENCE HELPERS (Zuckerberg Standard)
 * Merges partial data fragments into a complete state.
 */
function coalesceName(existing, incoming) {
    if (!incoming) return existing;
    if (!existing || /proporcionado|desconocido|luego|privado|\+/i.test(existing)) return incoming;

    const e = String(existing).trim();
    const i = String(incoming).trim();

    // If incoming is already contained or is a better version of existing
    if (e.toLowerCase().includes(i.toLowerCase())) return existing;
    if (i.toLowerCase().includes(e.toLowerCase())) return incoming;

    // Join with space if they seem to be parts (e.g. "Oscar" + "Rodriguez")
    return `${e} ${i}`;
}

function coalesceDate(existing, incoming) {
    if (!incoming) return existing;
    const normalizedIn = normalizeBirthDate(incoming);
    if (normalizedIn.isValid) return normalizedIn.date;

    // If existing part exists and new part arrives (e.g. "25" then "Mayo")
    // For now, satisfy with normalization, but additive logic could go here
    return incoming;
}

function getFirstName(fullName) {
    if (!fullName || typeof fullName !== 'string') return null;
    const parts = fullName.trim().split(/\s+/);
    return parts[0] || null;
}

const getIdentityLayer = (customPrompt = null) => {
    return customPrompt || DEFAULT_SYSTEM_PROMPT;
};

export const processMessage = async (candidateId, incomingMessage, msgId = null) => {
    const startTime = Date.now();
    try {
        const redis = getRedisClient();

        // 1. Initial High-Speed Parallel Acquisition (Memory Boost: 40 messages)
        const configKeys = [
            'custom_fields',
            'bot_ia_prompt',
            'assistant_ia_prompt',
            'ai_config',
            'candidatic_categories',
            'bot_extraction_rules',
            'bot_cerebro1_rules',
            'bypass_enabled',
            'bot_ia_model'
        ];

        const [candidateData, config, allMessages, batchConfig] = await Promise.all([
            getCandidateById(candidateId),
            getUltraMsgConfig(),
            getMessages(candidateId, 40),
            FEATURES.USE_BACKEND_CACHE
                ? getCachedConfigBatch(redis, configKeys)
                : (async () => {
                    const values = await redis?.mget(configKeys);
                    const obj = {};
                    configKeys.forEach((key, i) => obj[key] = values ? values[i] : null);
                    return obj;
                })()
        ]);

        if (!candidateData) return 'ERROR: No se encontró al candidato';

        // 🏎️ [EARLY PRESENCE]: Signal typing status immediately to reduce perceived latency
        if (config && candidateData.whatsapp) {
            sendUltraMsgPresence(config.instanceId, config.token, candidateData.whatsapp, 'composing').catch(() => { });
        }

        // 0. Initialize Candidate Updates accumulator
        const candidateUpdates = {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString(),
            esNuevo: candidateData.esNuevo === 'SI' ? 'NO' : candidateData.esNuevo
        };

        let intent = 'UNKNOWN';
        let isNowComplete = false;

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
            .slice(-20) // Memory Boost: 20 messages of history
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
                    role: role === 'model' ? 'assistant' : 'user',
                    content: content
                };
            });

        // 📋 [MISSION: Profile Complete?]
        // If history starts with 'model', remove leading model messages
        while (recentHistory.length > 0 && (recentHistory[0].role === 'model' || recentHistory[0].role === 'assistant')) {
            recentHistory.shift();
        }

        const lastUserMessages = validMessages.filter(m => m.from === 'user').slice(-5).map(m => m.content);
        const themes = lastUserMessages.length > 0 ? lastUserMessages.join(' | ') : 'Nuevo contacto';

        // Continuity & Session Logic
        const lastBotMsgAt = candidateData.lastBotMessageAt ? new Date(candidateData.lastBotMessageAt) : new Date(0);
        const minSinceLastBot = Math.floor((new Date() - lastBotMsgAt) / 60000);
        const secSinceLastBot = Math.floor((new Date() - lastBotMsgAt) / 1000);

        // 4. Layered System Instruction Build
        // Simplest check: Does Redis list have any bot/me message?
        const botHasSpoken = validMessages.some(m => m.from === 'bot' || m.from === 'me');
        const isNewFlag = candidateData.esNuevo !== 'NO' && !botHasSpoken;

        // Identity Protection (Titan Shield Pass) - System context for safety
        const realName = candidateData.nombreReal;
        let displayName = getFirstName(realName);

        if (!displayName || displayName === 'Desconocido' || /^\+?\d+$/.test(displayName)) {
            displayName = null;
        }
        const isNameBoilerplate = !displayName || /proporcionado|desconocido|luego|después|privado|hola|buenos|\+/i.test(String(displayName));


        const customFields = batchConfig.custom_fields ? JSON.parse(batchConfig.custom_fields) : [];
        const auditRaw = auditProfile(candidateData, customFields);

        // 🛡️ [GENDER SUPPRESSION]: Filter Gender from missing fields list. Prohibited from proactive asking.
        let audit = {
            ...auditRaw,
            missingLabels: auditRaw.missingLabels.filter(l => l !== 'Género' && l !== 'genero'),
            missingValues: auditRaw.missingValues.filter(v => v !== 'genero')
        };
        audit.paso1Status = audit.missingLabels.length === 0 ? 'COMPLETO' : 'INCOMPLETO';

        // 🧬 [ULTRA-SPEED CONSOLIDATION]: Redundant extraction removed.
        // Extraction is now handled natively by the main GPT brain at the end of the pipeline.
        const refinedData = null;

        // 🧬 [AUTO-GENDER PRE-PASS]: If name exists but gender doesn't, infer it NOW
        if (candidateData.nombreReal && !candidateData.genero) {
            const inferred = inferGender(candidateData.nombreReal);
            if (inferred) {
                candidateData.genero = inferred;
                candidateUpdates.genero = inferred;
                console.log(`[EARLY GENDER INFERENCE] 🧬 Inferred ${inferred} for ${candidateData.nombreReal}`);
            }
        }

        // Re-audit AFTER premium extraction and early inference
        const finalAudit = auditProfile(candidateData, customFields);

        // 🛡️ [PERFECT SYNC]: Update master audit and mode audit with suppressed final state
        audit = {
            ...finalAudit,
            missingLabels: finalAudit.missingLabels.filter(l => l !== 'Género' && l !== 'genero'),
            missingValues: finalAudit.missingValues.filter(v => v !== 'genero')
        };
        audit.paso1Status = audit.missingLabels.length === 0 ? 'COMPLETO' : 'INCOMPLETO';
        const auditForMode = audit;

        const customPrompt = batchConfig.bot_ia_prompt || '';
        let systemInstruction = getIdentityLayer(customPrompt);

        // --- GRACE & SILENCE ARCHITECTURE ---
        let isProfileComplete = audit.paso1Status === 'COMPLETO';
        const hasGratitude = candidateData.gratitudAlcanzada === true || candidateData.gratitudAlcanzada === 'true';
        // (minSinceLastBot already calculated at line 312)
        const isLongSilence = minSinceLastBot >= 5;

        //const isProfileComplete = audit.paso1Status === 'COMPLETO';
        const currentHasGratitude = hasGratitude;
        const currentIsSilenced = candidateData.silencioActivo === true || candidateData.silencioActivo === 'true';

        systemInstruction += `\n[ESTADO DE MISIÓN]:
- PERFIL COMPLETADO: ${isProfileComplete ? 'SÍ (SKIP EXTRACTION)' : 'NO (DATA REQUIRED)'}
- ¿Es Primer Contacto?: ${isNewFlag && !botHasSpoken ? 'SÍ (Presentarse)' : 'NO (Ya saludaste)'}
- [CHARLA_ACTIVA]: ${botHasSpoken ? 'TRUE (Omitir presentaciones formales)' : 'FALSE'}
- Gratitud Alcanzada: ${currentHasGratitude ? 'SÍ (Ya te dio las gracias)' : 'NO (Aún no te agradece)'}
- Silencio Operativo: ${currentIsSilenced ? 'SÍ (La charla estaba cerrada)' : 'NO (Charla activa)'}
\n[REGLA CRÍTICA]: SI [PERFIL COMPLETADO] ES SÍ, NO pidas datos proactivamente. Sin embargo, SI el usuario provee información nueva o corrige un dato (ej. "quiero cambiar mi nombre"), PROCÉSALO en extracted_data y confirma el cambio amablemente.`;

        // 🛡️ [PROMPT PRIORITY]: Only append hardcoded courtesy/logic rules if NO custom prompt is present
        // This avoids instructions redundancy (e.g. user prompt already handles greetings)
        if (!customPrompt) {
            systemInstruction += `\n[REGLA DE CORTESÍA]: Si el usuario te saluda ("Hola", "Buen día", etc.), DEBES devolver el saludo brevemente antes de pedir el dato faltante.
[SUFICIENCIA DE NOMBRE]: Si ya tienes un nombre y UN apellido, EL NOMBRE ESTÁ COMPLETO. No preguntes por más apellidos.`;
        }

        // Use Nitro Cached Config
        const aiConfigJson = batchConfig.ai_config;

        // 🧨 RESET COMMAND (TEMPORARY FOR TESTING)
        if (incomingMessage === 'RESET') {
            if (candidateData && candidateData.whatsapp) {
                const phone = candidateData.whatsapp;
                const id = candidateId;
                await redis.del(`candidate:${id}`);
                await redis.hdel('candidatic:phone_index', phone);
                if (config) {
                    await sendUltraMsgMessage(config.instanceId, config.token, phone, "🧨 DATOS BORRADOS. Eres un usuario nuevo. Di 'Hola' para empezar.");
                }
                return 'RESET_DONE';
            }
        }

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos.SI NO SABES EL NOMBRE REAL(Persona), NO LO INVENTES Y PREGÚNTALO.\n`;

        if (aiConfigJson) {
            // Config parsed from Redis
        }

        const userText = aggregatedText;
        const currentMessageForGpt = {
            role: 'user',
            content: aggregatedText
        };

        const lastBotMessages = validMessages
            .filter(m => (m.from === 'bot' || m.from === 'me') && !m.meta?.proactiveLevel)
            .slice(-20) // Extended unique history
            .map(m => m.content.trim());

        let categoriesList = "";
        const categoriesData = batchConfig.candidatic_categories || batchConfig.bot_categories || "General";
        try {
            const rawCats = typeof categoriesData === 'string' ? (categoriesData.includes('[') ? JSON.parse(categoriesData) : categoriesData.split(',').map(c => c.trim())) : categoriesData;
            const cats = Array.isArray(rawCats) ? rawCats : [rawCats];
            categoriesList = cats.map(c => `✅ ${typeof c === 'string' ? c : (c.name || c.value || JSON.stringify(c))}`).join('\n');
        } catch (e) {
            console.warn('Error parsing categories:', e);
            categoriesList = String(categoriesData).split(',').map(c => `✅ ${c.trim()}`).join('\n');
        }

        const customExtractionRules = batchConfig.bot_extraction_rules;
        const extractionRules = (customExtractionRules || DEFAULT_EXTRACTION_RULES)
            .replace('{{categorias}}', categoriesList)
            .replace('CATEGORÍAS VÁLIDAS: ', `CATEGORÍAS VÁLIDAS: ${categoriesList} `);

        const safeDnaLines = audit.dnaLines.split('\n').filter(l => !l.toLowerCase().includes('género') && !l.toLowerCase().includes('genero')).join('\n');

        systemInstruction += `\n[ESTADO DEL CANDIDATO]:
- Perfil Completo: ${audit.paso1Status === 'COMPLETO' ? 'SÍ' : 'NO'}
- Nombre Real: ${candidateData.nombreReal || 'No proporcionado'}
- WhatsApp: ${candidateData.whatsapp}
- Municipio: ${candidateData.municipio || 'No proporcionado'}
- Categoría: ${candidateData.categoria || 'No proporcionado'}
${safeDnaLines}
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
                intent = await classifyIntent(candidateId, aggregatedText, historyForGpt.map(h => h.content || '').join('\n'));

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
                                content: `[SISTEMA INTERNO]: El candidato rechazó la vacante anterior.Ahora preséntale la siguiente vacante disponible(índice ${newIdx}).Es la primera vez que la ve.NO asumas que la rechaza — apreséntatela con entusiasmo y espera su respuesta.`
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
                    const openAiKey = activeAiConfig.openaiApiKey || process.env.OPENAI_API_KEY;
                    if (activeVacancyId && openAiKey) {
                        const { processUnansweredQuestion } = await import('./faq-engine.js');
                        if (unansweredQ) {
                            console.log(`[FAQ Engine] 📡 Capturing UNANSWERED: "${unansweredQ}" → vacancy ${activeVacancyId}`);
                            await recordAITelemetry(candidateId, 'faq_detected', { vacancyId: activeVacancyId, question: unansweredQ });
                            processUnansweredQuestion(activeVacancyId, unansweredQ, responseTextVal, openAiKey)
                                .then(() => console.log(`[FAQ Engine] ✅ Unanswered question saved`))
                                .catch(e => console.error('[FAQ Engine] ❌ Cluster Error (unanswered):', e));
                        } else {
                            const lastUserMsg = historyForGpt.filter(h => h.role === 'user').slice(-1)[0];
                            const userText = lastUserMsg?.content || '';
                            const questionPatterns = /[?¿]|cuál|cómo|cuánto|cuándo|dónde|qué|quién|hacen|tienen|hay|incluye|es|son|dan|pagan|trabaj|horario|sueldo|salario|uniforme|transporte|beneficio|requisito|antidop/i;
                            const isQuestion = questionPatterns.test(userText) && userText.length > 5;
                            if (isQuestion && responseTextVal) {
                                console.log(`[FAQ Engine] 📝 Recording ANSWERED question: "${userText}"`);
                                processUnansweredQuestion(activeVacancyId, userText, responseTextVal, openAiKey)
                                    .then(() => console.log(`[FAQ Engine] ✅ Answered question saved to FAQ log`))
                                    .catch(e => console.error('[FAQ Engine] ❌ Cluster Error (answered):', e));
                            }
                        }
                    } else {
                        console.warn(`[FAQ Engine] ⚠️ Skipped — missing vacancyId(${activeVacancyId}) or openAiKey`);
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
                    const lastBotMsg = historyForGpt.filter(h => h.role === 'assistant' || h.role === 'model').slice(-1)[0];
                    const botText = (lastBotMsg?.content || '').toLowerCase();
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
                                    { role: 'user', content: `[SISTEMA]: El candidato acaba de avanzar al paso "${nextStep.name}".Este es tu primer contacto en este paso.Sigue tu OBJETIVO DE PASO.` }
                                ];
                                if (recruiterFinalSpeech) historyForNextStep.splice(-1, 0, { role: 'assistant', content: recruiterFinalSpeech });

                                const nextAiResult = await processRecruiterMessage(
                                    { ...candidateData, ...candidateUpdates },
                                    project, nextStep, historyForNextStep, config,
                                    activeAiConfig.openaiApiKey,
                                    candidateUpdates.currentVacancyIndex !== undefined ? candidateUpdates.currentVacancyIndex : currentIdx
                                );

                                if (nextAiResult?.response_text) {
                                    await new Promise(r => setTimeout(r, 800));
                                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, nextAiResult.response_text);
                                    await saveMessage(candidateId, { from: 'me', content: nextAiResult.response_text, timestamp: new Date().toISOString() });
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
        let isBridgeActive = false;
        let isHostMode = false;

        // 🛡️ [SILENCE SHIELD REMOVED]: Since follow-up system is gone, we no longer muzzle Brenda after completion.
        // We now allow GPT Host or Capturista Brain to handle social interactions naturally.

        const bridgeCounter = (typeof candidateData.bridge_counter === 'number') ? parseInt(candidateData.bridge_counter || 0) : 0;
        candidateUpdates.bridge_counter = bridgeCounter + 1; // Now correctly persisted in candidateUpdates

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

        // 3. CAPTURISTA BRAIN (GPT-4o-mini consolidated)
        if (!isRecruiterMode && !isBridgeActive && !isHostMode) {
            try {
                let handoverTriggered = false;
                const gptStartTime = Date.now();

                // 🏎️ [FORCE STATUS]: If speaking now, they are no longer NEW.
                if (isNewFlag) {
                    candidateUpdates.esNuevo = 'NO';
                    await updateCandidate(candidateId, { esNuevo: 'NO' });
                }
                // Build Instructions
                const extractionRules = batchConfig.bot_extraction_rules || DEFAULT_EXTRACTION_RULES;
                systemInstruction += `\n[REGLAS DE EXTRACCIÓN (VIPER-GPT)]: ${extractionRules.replace(/{{categorias}}/g, categoriesList)}`;

                systemInstruction += `\n[FORMATO OBLIGATORIO]: Responde SIEMPRE en JSON puro con este esquema:
{
  "response_text": "Texto para el usuario",
  "extracted_data": { "nombreReal": "Valor", "genero": "Valor", ... },
  "reaction": "Emoji o null",
  "thought_process": "Breve nota interna"
}

[RECONOCIMIENTO DE TURNO]: 
- Si el usuario menciona su nombre o apellidos, inclúyelo en "extracted_data.nombreReal".
- IMPORTANTE: Si el usuario sólo te da un nombre sin apellidos (ej: "Oscar"), extráelo y PREGUNTA POR SUS APELLIDOS amablemente para poder completar su registro.
- "Nombre Completo" se considera válido SOLO si hay al menos dos palabras separadas por espacios.
- Si el usuario dice "Ya te lo dije" o similar, NO repitas la misma pregunta; revisa bien el mensaje anterior o el ADN y discúlpate con encanto antes de seguir.\n`;

                if (isNewFlag) {
                    const welcomeName = customPrompt ? 'tu identidad' : 'la Lic. Brenda Rodríguez';
                    systemInstruction += `\n[MISION: BIENVENIDA]: Es el inicio. Preséntate como ${welcomeName} y solicita el Nombre y Apellidos. ✨🌸\n`;
                } else if (auditForMode.paso1Status !== 'COMPLETO') {
                    candidateUpdates.esNuevo = 'NO';
                    let baseRules = batchConfig.bot_cerebro1_rules || DEFAULT_CEREBRO1_RULES;

                    const cerebro1Rules = baseRules
                        .replace('{{faltantes}}', auditForMode.missingLabels.join(', '))
                        .replace(/{{categorias}}/g, categoriesList)
                        .replace(/\[LISTA DE CATEGORÍAS\]/g, categoriesList);
                    systemInstruction += `\n${cerebro1Rules}\n`;
                }

                // Call Magic GPT (Dynamic Model)
                const selectedModel = batchConfig.bot_ia_model || 'gpt-4o-mini';
                const gptResult = await getOpenAIResponse(recentHistory, `${systemInstruction}\n[ADN]: ${JSON.stringify(candidateData)}`, selectedModel, activeAiConfig.openaiApiKey, { type: "json_object" });

                if (gptResult?.content) {
                    try {
                        let jsonMatch = gptResult.content.match(/\{[\s\S]*\}/);
                        const cleanJson = jsonMatch ? jsonMatch[0] : gptResult.content;
                        aiResult = JSON.parse(cleanJson);
                        recordAITelemetry(candidateId, 'consolidated_brain', {
                            model: selectedModel,
                            latency: Date.now() - gptStartTime,
                            tokens: gptResult.usage?.total_tokens || 0
                        });
                        responseTextVal = aiResult.response_text;
                        console.log(`[GPT CONSOLIDATED] ✅ Extraction + Response:`, aiResult);
                    } catch (err) {
                        console.error('[GPT BRAIN] JSON Parse Fail:', err.message);
                        throw new Error('GPT returned invalid JSON');
                    }
                }

                // Merge Extracted Data
                if (aiResult?.extracted_data && Object.keys(aiResult.extracted_data).length > 0) {
                    const ext = aiResult.extracted_data;
                    if (ext.nombreReal) {
                        ext.nombreReal = coalesceName(candidateData.nombreReal, ext.nombreReal);
                        if (!candidateData.genero && !ext.genero) {
                            const inferred = inferGender(ext.nombreReal);
                            if (inferred) ext.genero = inferred;
                        }
                    }
                    if (ext.fechaNacimiento) {
                        ext.fechaNacimiento = coalesceDate(candidateData.fechaNacimiento, ext.fechaNacimiento);
                    }
                    Object.assign(candidateUpdates, ext);
                }

                // Guardrail Pass
                const freshAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
                const guardContext = {
                    isProfileComplete: freshAudit.paso1Status === 'COMPLETO',
                    missingFields: freshAudit.missingLabels,
                    lastInput: aggregatedText,
                    isNewFlag: isNewFlag,
                    candidateName: displayName,
                    lastBotMessages,
                    categoriesList
                };
                const validation = await AIGuard.validate(aiResult, guardContext, allMessages);
                if (validation && validation.recovery_active) {
                    aiResult = validation;
                    responseTextVal = aiResult.response_text;
                    if (aiResult.extracted_data) Object.assign(candidateUpdates, aiResult.extracted_data);
                }


                // Transition Logic
                const finalAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
                isNowComplete = finalAudit.paso1Status === 'COMPLETO';

                if (await Orchestrator.checkBypass(candidateData, finalAudit, batchConfig.bypass_enabled === 'true')) {
                    const handoverResult = await Orchestrator.executeHandover({ ...candidateData, ...candidateUpdates }, config, msgId);
                    if (handoverResult?.triggered) {
                        Object.assign(candidateUpdates, { projectId: handoverResult.projectId, stepId: handoverResult.stepId });
                        responseTextVal = null;
                        handoverTriggered = true;
                    }
                }

                if (!handoverTriggered && isNowComplete && !candidateData.congratulated) {
                    responseTextVal = "¡Listo! 🌟 Ya tengo todos tus datos guardados. Pronto un reclutador te contactará. ✨🌸";
                    candidateUpdates.congratulated = true;
                    await MediaEngine.sendCongratsPack(config, candidateData.whatsapp, 'bot_celebration_sticker');
                }

            } catch (err) {
                console.error('❌ [GPT BRAIN FATAL] Error:', err.message);
                const fbContext = {
                    isProfileComplete: audit?.paso1Status === 'COMPLETO',
                    missingFields: audit?.missingLabels || [],
                    isNewFlag: isNewFlag,
                    candidateName: displayName,
                    lastBotMessages,
                    categoriesList
                };
                aiResult = AIGuard.validate(null, fbContext);
                responseTextVal = aiResult?.response_text;
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

        const isTechnicalOrEmpty = !resText || ['null', 'undefined', '[SILENCIO]', '[REACCIÓN/SILENCIO]'].includes(resText) || resText.startsWith('[REACCIÓN:');

        // 🛡️ [FINAL DELIVERY SAFEGUARD]: If Brenda is about to go silent but profile isn't closed, force a fallback
        if (isTechnicalOrEmpty && !aiResult?.close_conversation && !isRecruiterMode) {
            console.warn(`[FINAL SAFEGUARD] 🚨 Silence detected for candidate ${candidateId}. Forcing fallback.`);
            responseTextVal = "¡Ay! Me distraje un segundo. 😅 ¿Qué me decías?";
        }

        if (responseTextVal && !isTechnicalOrEmpty) {
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
                    const textPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseTextVal, 'chat', { priority: 0 });
                    const mediaPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, mUrl, isPdf ? 'document' : 'image', { filename, priority: 0 });

                    await Promise.allSettled([textPromise, mediaPromise]);
                    console.log(`[MEDIA DELIVERY] Sent parallel text + ${isPdf ? 'PDF' : 'IMAGE'}`);
                } else {
                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseTextVal, 'chat', { priority: 0 }).catch(() => { });
                    console.log(`[TEXT DELIVERY] Sent text only: ${candidateId}`);
                }
            })();
        }

        // 🧬 [STATE SYNC] Ensure we know if they are complete even if we didn't go through Gemini
        if (!isNowComplete) {
            const finalAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
            isNowComplete = finalAudit.paso1Status === 'COMPLETO';
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
            reactionPromise,
            updateCandidate(candidateId, candidateUpdates),
            saveMessage(candidateId, {
                from: 'me',
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
