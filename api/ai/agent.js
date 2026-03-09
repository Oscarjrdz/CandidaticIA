// [PREMIUM ARCHITECTURE] V_FINAL_STABLE_V1 - Zero-Silence Infrastructure Active
/* global process */
import { processUnansweredQuestion } from './faq-engine.js';
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
import { sendUltraMsgMessage, getUltraMsgConfig, sendUltraMsgReaction } from '../whatsapp/utils.js';
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

// 🚀 TURBO MODE: Silence all synchronous Vercel console I/O unless actively debugging
if (process.env.DEBUG_MODE !== 'true') {
    console.log = function () { };
}

export const DEFAULT_EXTRACTION_RULES = `
[EXTRAER]: nombreReal, genero, fechaNacimiento, edad, municipio, categoria, escolaridad.
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
 1. CORTESÍA PROFESIONAL: Si el usuario dice "Sí", "Claro", "Te ayudo" o saluda, responde siempre de manera amable pero PROFESIONAL. Tienes ESTRICTAMENTE PROHIBIDO usar lenguaje coqueto o informal como "me chiveas" o "qué lindo". Eres una Licenciada en Recursos Humanos y debes mantener el respeto.
 2. NOMBRE COMPLETO: Si solo te da el nombre de pila sin apellidos, agradécele y pídele sus apellidos con amabilidad profesional para avanzar en su registro.
 3. CATEGORÍA: Si AÚN NO has mostrado la lista de categorías en este historial, muéstrala en formato vertical con ✅ y doble salto de línea entre cada opción. Si YA la mostraste (revisa el historial), TIENES PROHIBIDO repetirla completa — solo pregunta: "¿Cuál de las opciones que te compartí te interesa más?".
     ESTRUCTURA al mostrar por PRIMERA VEZ:
     "¡Perfecto! Mira, estas son las opciones que tengo para ti: 

     {{categorias}}

     ¿Cuál de estas opciones te interesa?"
 4. FORMATO ESCOLARIDAD: Cuando preguntes por el nivel de escolaridad, es ESTRICTAMENTE OBLIGATORIO que muestres las opciones en una lista VERTICAL con un emoji diferente y un DOBLE salto de línea (\n\n) entre cada opción (ej: 🎒 Primaria \n\n 🏫 Secundaria \n\n ...). ¡PROHIBIDO ponerlas en el mismo renglón separadas por comas!
 5. FECHA DE NACIMIENTO: Pídela SIEMPRE dando el ejemplo exacto: "(ej: 19/05/1990)". No lo olvides.
 5. DINÁMICA: Si responde algo que no sea el dato (ej: "No vivo ahí", "No sé"), SIEMPRE sé empática primero ("Entiendo perfectamente") y luego re-enfoca pidiendo el dato que falta o el siguiente.
 6. PERSUASIÓN (PREGUNTAS DE VACANTES/SUELDO/LUGAR/ENTREVISTAS): Cuando el candidato pregunta algo como "¿Dónde son?", "¿Cuándo son las entrevistas?", "¿Cuánto pagan?", DEBES: (a) Responder BREVEMENTE con algo real y positivo (ej: "Las entrevistas son en la zona metropolitana de Monterrey, te confirmamos la dirección exacta cuando completemos tu registro 😊"), y (b) Redirigir amablemente al dato faltante: {{faltantes}}. NUNCA ignores la pregunta ni la respondas con la lista de categorías en lugar de una respuesta real.
 7. LENGUAJE: PROHIBIDO decir "base de datos" o "robot". Di "nuestro sistema" o "tu registro en la plataforma".
 8. CORTESÍA INICIAL: Si te saluda, salúdalo de vuelta amablemente antes de pedir el dato.
 9. PREGUNTAS PERSONALES: Eres Brenda Rodríguez de Monterrey. Mantén siempre el perfil estrictamente profesional si preguntan cosas personales y regresa al tema de reclutamiento. PROHIBIDO DECIR QUE ERES UN BOT.`;

export const DEFAULT_SYSTEM_PROMPT = `
[PERSONALIDAD]:
Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
Eres carismática, profesional, coqueta y muy divertida. 
Hablas como una joven de oficina que usa su encanto para que los candidatos se sientan en confianza.
Usa emojis para hacerlo agradable y tierno, no uses los mismos siempre. No uses asteriscos (*).

[REGLAS DE ORO]:
- NUNCA REPITAS MENSAJES. Sé creativa, varía tus palabras.
- PERSUASIÓN (vacantes/entrevistas/empleo): Si el candidato pregunta por vacantes, sueldos, entrevistas, lugar o cualquier información de empleo Y el perfil está incompleto, responde de forma coherente y natural reconociendo la pregunta. Explica que para poder compartirle esa información personalizada, primero necesitas completar su registro. Luego redirige al dato faltante. NUNCA ignores la pregunta ni la respondas con la lista de categorías. Ejemplo: "Claro 😊, las vacantes son en la zona metropolitana de Monterrey. Para decirte exactamente cuál te conviene más, primero necesito que completemos tu registro. ¿Cuál categoría te interesa?"
- Si te ligan o halagan: Responde con picardía, gracia y mucha dulzura (ej: "¡Ay, qué lindo! 🤭✨ me chiveas"), pero re-enfoca a la extracción inmediatamente para no perder el tiempo.
- CURIOSIDAD DEL USUARIO: Si te preguntan si eres un bot, di que eres una persona real (reclutadora de 25 años viviendo en Monterrey). NUNCA admitas ser IA.
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

    let day, month, year;
    let matched = false;

    // 1. Try Natural Spanish Date (e.g. "19 de mayo de 1988" or "19 mayo 88")
    const textPattern = /^(\d{1,2})\s*(?:de\s+)?([a-zA-Z]+)\s*(?:de\s+)?(\d{2,4})$/i;
    const textMatch = cleaned.match(textPattern);

    if (textMatch) {
        const meses = {
            'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
            'julio': '07', 'agosto': '08', 'septiembre': '09', 'setiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
        };
        const mText = textMatch[2].toLowerCase();
        if (meses[mText]) {
            day = textMatch[1];
            month = meses[mText];
            year = textMatch[3];
            matched = true;
        }
    }

    // 2. Try Numeric Patterns
    if (!matched) {
        for (const pattern of patterns) {
            const match = cleaned.match(pattern);
            if (match) {
                [, day, month, year] = match;
                matched = true;
                break;
            }
        }
    }

    if (matched) {
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

    // 🧬 SMART REPLACEMENT: If the user provides a completely new full name (2+ words)
    // and it shares at least one significant word with the old name (e.g., "Oscar"), 
    // it's a correction, not an addition. Overwrite it.
    const eWords = e.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const iWords = i.toLowerCase().split(/\s+/).filter(w => w.length > 0);

    if (iWords.length >= 2) {
        // Did they share a word? (e.g. "oscar rodriguez" vs "oscar martinez")
        const sharedWord = eWords.some(ew => i.toLowerCase().includes(ew));
        if (sharedWord || iWords.length > eWords.length) {
            return incoming;
        }
    }

    // Fallback: Join with space if they seem to be disjoint parts (e.g. "Oscar" + "Rodriguez")
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
            .slice(-10) // Memory Boost: 10 messages of history (Optimized for Vercel Serverless latency)
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

        // 🧬 [AUTO-GENDER PRE-PASS]: Infer gender from name before audit
        if (candidateData.nombreReal && !candidateData.genero) {
            const inferred = inferGender(candidateData.nombreReal);
            if (inferred) {
                candidateData.genero = inferred;
                candidateUpdates.genero = inferred;
            }
        }

        // Single audit pass after gender inference
        const finalAudit = auditProfile(candidateData, customFields);
        // 🛡️ [GENDER SUPPRESSION]: Filter Gender from missing fields list
        let audit = {
            ...finalAudit,
            missingLabels: finalAudit.missingLabels.filter(l => l !== 'Género' && l !== 'genero'),
            missingValues: finalAudit.missingValues.filter(v => v !== 'genero')
        };
        audit.paso1Status = audit.missingLabels.length === 0 ? 'COMPLETO' : 'INCOMPLETO';
        const auditForMode = audit;

        const customPrompt = batchConfig.bot_ia_prompt || '';
        let systemInstruction = getIdentityLayer(customPrompt);

        // --- GRACE & SILENCE ARCHITECTURE ---
        const isProfileComplete = audit.paso1Status === 'COMPLETO';
        const hasGratitude = candidateData.gratitudAlcanzada === true || candidateData.gratitudAlcanzada === 'true';
        const isLongSilence = minSinceLastBot >= 5;
        const currentIsSilenced = candidateData.silencioActivo === true || candidateData.silencioActivo === 'true';

        systemInstruction += `\n[ESTADO DE MISIÓN]:
- PERFIL COMPLETADO: ${isProfileComplete ? 'SÍ (SKIP EXTRACTION)' : 'NO (DATA REQUIRED)'}
- ¿Es Primer Contacto?: ${isNewFlag && !botHasSpoken ? 'SÍ (Presentarse)' : 'NO (Ya saludaste)'}
- [CHARLA_ACTIVA]: ${botHasSpoken ? 'TRUE (Omitir presentaciones formales)' : 'FALSE'}
- Gratitud Alcanzada: ${hasGratitude ? 'SÍ (Ya te dio las gracias)' : 'NO (Aún no te agradece)'}
- Silencio Operativo: ${currentIsSilenced ? 'SÍ (La charla estaba cerrada)' : 'NO (Charla activa)'}
\n[REGLA CRÍTICA]: SI [PERFIL COMPLETADO] ES SÍ, NO pidas datos proactivamente. Sin embargo, SI el usuario provee información nueva o corrige un dato (ej. "quiero cambiar mi nombre"), PROCÉSALO en extracted_data y confirma el cambio amablemente.`;

        // 🛡️ [PROMPT PRIORITY]: Only append hardcoded courtesy/logic rules if NO custom prompt is present
        // This avoids instructions redundancy (e.g. user prompt already handles greetings)
        if (!customPrompt) {
            systemInstruction += `\n[REGLA DE CORTESÍA]: Si el usuario te saluda ("Hola", "Buen día", etc.), DEBES devolver el saludo brevemente antes de pedir el dato faltante.
[SUFICIENCIA DE NOMBRE]: Si ya tienes un nombre y UN apellido, EL NOMBRE ESTÁ COMPLETO. No preguntes por más apellidos.`;
        }

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos.SI NO SABES EL NOMBRE REAL(Persona), NO LO INVENTES Y PREGÚNTALO.\n`;
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
            categoriesList = cats.map(c => `✅ ${typeof c === 'string' ? c : (c.name || c.value || JSON.stringify(c))}`).join('\n\n');
        } catch (e) {
            categoriesList = String(categoriesData).split(',').map(c => `✅ ${c.trim()}`).join('\n\n');
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
            // ⚡ FIX 1: Single parallel read — project data + cand_meta (was 2 sequential hgets for the same key)
            const redisForMeta = getRedisClient();
            const [projectResult, metaRawUnified] = await Promise.all([
                getProjectById(activeProjectId),
                redisForMeta ? redisForMeta.hget(`project:cand_meta:${activeProjectId}`, candidateId).catch(() => null) : Promise.resolve(null)
            ]);
            project = projectResult;

            // Single parse of metaRawUnified — used for both stepId and currentVacancyIndex
            let parsedMeta = null;
            try { if (metaRawUnified) parsedMeta = JSON.parse(metaRawUnified); } catch (_) { }

            if (parsedMeta?.stepId && parsedMeta.stepId !== 'step_new') {
                activeStepId = parsedMeta.stepId;
            }

            const currentStep = project?.steps?.find(s => s.id === activeStepId) || project?.steps?.[0];

            // Active vacancy index — prefer project:cand_meta (most authoritative source)
            let currentIdx = parsedMeta?.currentVacancyIndex !== undefined
                ? parsedMeta.currentVacancyIndex
                : (candidateData.currentVacancyIndex !== undefined
                    ? candidateData.currentVacancyIndex
                    : (candidateData.projectMetadata?.currentVacancyIndex || 0));

            let activeVacancyId = null;
            if (project?.vacancyIds && project.vacancyIds.length > 0) {
                activeVacancyId = project.vacancyIds[Math.min(currentIdx, project.vacancyIds.length - 1)];
            } else if (project?.vacancyId) {
                activeVacancyId = project.vacancyId;
            }

            let recruiterTriggeredMove = false;

            if (currentStep?.aiConfig?.enabled && currentStep.aiConfig.prompt) {
                isRecruiterMode = true;
                const activeAiConfig = batchConfig.ai_config ? (typeof batchConfig.ai_config === 'string' ? JSON.parse(batchConfig.ai_config) : batchConfig.ai_config) : {};

                // --- MULTI-VACANCY REJECTION SHIELD ---
                let skipRecruiterInference = false;

                // ⚡ FIX 2: Run intent classifier IN PARALLEL with the recruiter LLM
                // We only need the result if the candidate rejected/pivoted — checked after both resolve
                const hasMultiVacancy = project.vacancyIds && project.vacancyIds.length > 0;
                const intentPromise = hasMultiVacancy
                    ? classifyIntent(candidateId, aggregatedText, historyForGpt.map(h => h.content || '').join('\n'))
                    : Promise.resolve('UNKNOWN');

                // intentPromise runs concurrently — resolved after recruiter call below
                // We resolve it NOW only when we need it for the rejection check
                intent = await intentPromise;

                if ((intent === 'REJECTION' || intent === 'PIVOT') && hasMultiVacancy) {
                    const isPivot = intent === 'PIVOT';
                    const currentIdx = candidateData.currentVacancyIndex || 0;

                    // ⚡ FIX 5: Extract rejection reason from candidate text directly — no extra GPT call
                    const words = aggregatedText.trim().split(/\s+/).slice(0, 6).join(' ');
                    const reason = words.length > 2 ? words : 'No le interesó';

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
                        // Instead of just silencing, we prepare to fire a move:exit
                        aiResult = {
                            thought_process: "ALL_VACANCIES_REJECTED { move: exit }",
                            response_text: null,
                            close_conversation: true,
                            reaction: '👍'
                        };
                        skipRecruiterInference = true;
                    } else {
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
                        const { categoria, municipio, escolaridad, citaFecha, citaHora } = aiResult.extracted_data;
                        if (categoria) candidateUpdates.categoria = categoria;
                        if (municipio) candidateUpdates.municipio = municipio;
                        if (escolaridad) candidateUpdates.escolaridad = escolaridad;

                        // Calendario / Agenda (Guardar en projectMetadata)
                        if (citaFecha || citaHora) {
                            if (!candidateUpdates.projectMetadata) {
                                candidateUpdates.projectMetadata = { ...(candidateData.projectMetadata || {}) };
                            }
                            if (citaFecha && citaFecha !== 'null') candidateUpdates.projectMetadata.citaFecha = citaFecha;
                            if (citaHora && citaHora !== 'null') candidateUpdates.projectMetadata.citaHora = citaHora;
                        }

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
                    }

                    // 🎯 FAQ RADAR: Save to FAQ engine regardless — unanswered OR answered
                    const openAiKey = activeAiConfig.openaiApiKey || process.env.OPENAI_API_KEY;
                    if (activeVacancyId && openAiKey) {
                        if (unansweredQ) {
                            await recordAITelemetry(candidateId, 'faq_detected', { vacancyId: activeVacancyId, question: unansweredQ });
                            processUnansweredQuestion(activeVacancyId, unansweredQ, responseTextVal, openAiKey)
                                .catch(() => { });
                        } else {
                            const lastUserMsg = historyForGpt.filter(h => h.role === 'user').slice(-1)[0];
                            const userText = lastUserMsg?.content || '';
                            const questionPatterns = /[?¿]|cuál|cómo|cuánto|cuándo|dónde|qué|quién|hacen|tienen|hay|incluye|es|son|dan|pagan|trabaj|horario|sueldo|salario|uniforme|transporte|beneficio|requisito|antidop/i;
                            const isQuestion = questionPatterns.test(userText) && userText.length > 5;
                            if (isQuestion && responseTextVal) {
                                processUnansweredQuestion(activeVacancyId, userText, responseTextVal, openAiKey)

                                    .catch(() => { });
                            }
                        }
                    } else {
                    }
                }

                // ⚡ ROBUST MOVE TAG DETECTION WITH PAYLOAD PARSING
                // Attempt to parse advanced JSON-like tags: { move: "Citados", setDate: "Lunes", setTime: "10:00" }
                // Or fallback to classic: { move } / { move: exit }
                // Notice the ".*?" is optional so that `{ move }` works
                const tpValue = aiResult?.thought_process || '';
                const rtValue = aiResult?.response_text || '';
                const advanceBracketsMatch = tpValue.match(/[\{\[]\s*(move.*?)[\}\]]/is) ||
                    rtValue.match(/[\{\[]\s*(move.*?)[\}\]]/is);

                let hasMoveTag = false;
                let hasExitTag = false;
                let extractedMoveTarget = null;

                if (advanceBracketsMatch && advanceBracketsMatch[0]) {
                    hasMoveTag = true;
                    // Keep just the string `{ move }` or `{ move: exit }`
                    const innerContent = advanceBracketsMatch[0];

                    // If it specifically says exit or no_interesa
                    if (/move:\s*(exit|no_interesa|no interesa)/i.test(innerContent)) {
                        hasExitTag = true;
                    }

                    // Try to extract setDate / setTime using loose Regex (JSON.parse often fails on LLM output)
                    const dateMatch = innerContent.match(/setDate:\s*["']([^"']+)["']/i);
                    const timeMatch = innerContent.match(/setTime:\s*["']([^"']+)["']/i);
                    // Match `move: "Cita"` or `move: 'Cita'` or even `move: Cita` WITHOUT QUOTES
                    const specificMoveMatch = innerContent.match(/move:\s*["']?([^"'\s}]+)["']?/i);

                    if (specificMoveMatch && specificMoveMatch[1]) {
                        extractedMoveTarget = specificMoveMatch[1].trim();
                        // Auto-detect if target was exit
                        if (extractedMoveTarget.toLowerCase().includes('no interesa') || extractedMoveTarget.toLowerCase() === 'exit') {
                            hasExitTag = true;
                        }
                    }

                    if (dateMatch || timeMatch) {
                        if (!candidateUpdates.projectMetadata) {
                            candidateUpdates.projectMetadata = { ...candidateData.projectMetadata };
                        }
                        if (dateMatch && dateMatch[1]) candidateUpdates.projectMetadata.citaFecha = dateMatch[1].trim();
                        if (timeMatch && timeMatch[1]) candidateUpdates.projectMetadata.citaHora = timeMatch[1].trim();
                    }
                }

                // 🛡️ CONTEXTUAL SAFETY TRIGGER (MARK STYLE)
                // If Brenda forgets the tag but the developer-certified intent is ACCEPTANCE 
                // AND the bot just asked to schedule, we force the move.
                let inferredAcceptance = false;
                if (!hasMoveTag) {
                    const lastBotMsg = historyForGpt.filter(h => h.role === 'assistant' || h.role === 'model').slice(-1)[0];
                    const botText = (lastBotMsg?.content || '').toLowerCase();
                    const isInterviewInvite = /agendar|agendamos|te queda bien|estamos de acuerdo/i.test(botText);

                    const isUserAffirmative = /^(si|sí|claro|por supuesto|obvio|va|dale|ok|okay|sipi|simon|simón|me parece bien|está bien|perfecto|excelente|adelante)/i.test(aggregatedText.trim());

                    // Let's loosen the restriction here. If the user is affirmative AND this is a step 
                    // where Brenda might simply "accept" (Filtro Step), we can just force the move.
                    const originStepName = (currentStep?.name || '').toLowerCase();
                    const isFiltro = originStepName.includes('filtro') || originStepName.includes('inicio') || originStepName.includes('contacto');

                    if ((isInterviewInvite && (intent === 'ACCEPTANCE' || isUserAffirmative)) || (isFiltro && isUserAffirmative)) {
                        hasMoveTag = true;
                        inferredAcceptance = true;
                    }

                    // Check THIS bot text for confirmation of appointment
                    const thisBotText = (aiResult?.response_text || '').toLowerCase();
                    let isCitaConfirmation = thisBotText.includes('queda agendada') ||
                        thisBotText.includes('entrevista agendada') ||
                        thisBotText.includes('confirmada tu entrevista');

                    if (!hasMoveTag && isCitaConfirmation) {
                        hasMoveTag = true;
                        extractedMoveTarget = "Citados";
                        inferredAcceptance = true;

                        // Attempt to extract date and time from the text as fallback
                        const dateRegex = /(?:para el|el d[íi]a)\s+([a-zA-Z0-9\s]+?)\s+a\s+las/i;
                        const timeRegex = /a\s+las\s+([0-9:]+\s*(?:AM|PM|am|pm|hrs))/i;

                        const textDateMatch = aiResult?.response_text?.match(dateRegex);
                        const textTimeMatch = aiResult?.response_text?.match(timeRegex);

                        if (textDateMatch || textTimeMatch) {
                            if (!candidateUpdates.projectMetadata) {
                                candidateUpdates.projectMetadata = { ...(candidateData.projectMetadata || {}) };
                            }
                            if (textDateMatch) candidateUpdates.projectMetadata.citaFecha = textDateMatch[1].trim();
                            if (textTimeMatch) candidateUpdates.projectMetadata.citaHora = textTimeMatch[1].trim();

                        }
                    }
                }

                // 🛡️ [CITA STEP SAFEGUARD & CALENDAR RENDERER]
                const isCitaStep = (currentStep?.name || '').toLowerCase().includes('cita');
                if (isCitaStep && !hasExitTag) {
                    const mergedMeta = { ...(candidateData.projectMetadata || {}), ...(candidateUpdates.projectMetadata || {}) };

                    // Fallback to extract from historical context if somehow lost
                    if (!mergedMeta.citaFecha || !mergedMeta.citaHora || mergedMeta.citaFecha === 'null' || mergedMeta.citaHora === 'null') {
                        const allContext = historyForGpt.map(h => typeof h.content === 'string' ? h.content : JSON.stringify(h.content)).join(' ');
                        const dateFallback = allContext.match(/(?:para el|el d[íi]a)\s+([a-zA-Z0-9\s]+?)\s+a\s+las/i);
                        const timeFallback = allContext.match(/a\s+las\s+([0-9:]+\s*(?:AM|PM|am|pm|hrs))/i);
                        if (dateFallback && !mergedMeta.citaFecha) mergedMeta.citaFecha = dateFallback[1].trim();
                        if (timeFallback && !mergedMeta.citaHora) mergedMeta.citaHora = timeFallback[1].trim();

                        if (dateFallback || timeFallback) {
                            candidateUpdates.projectMetadata = mergedMeta;
                        }
                    }

                    const isInvalidFecha = !mergedMeta.citaFecha || mergedMeta.citaFecha === 'null' || String(mergedMeta.citaFecha).includes('YYYY') || String(mergedMeta.citaFecha).includes('N/A');
                    const isInvalidHora = !mergedMeta.citaHora || mergedMeta.citaHora === 'null' || String(mergedMeta.citaHora).includes('string') || String(mergedMeta.citaHora).includes('N/A');

                    // 1) VETO LOGIC: If AI tries to move without both pieces of data, BLOCK IT.
                    if (hasMoveTag && (isInvalidFecha || isInvalidHora)) {
                        hasMoveTag = false;
                        inferredAcceptance = false;
                        isCitaConfirmation = false;
                    }

                    // 2) FALLBACK RENDERER: If we are missing data, force the question/calendar array.
                    // This must run even if hasMoveTag is false!
                    if (isInvalidFecha || isInvalidHora) {
                        const lowerResponse = (responseTextVal || "").toLowerCase();
                        const isMissingDayOrHour = (!lowerResponse.includes('día') && !lowerResponse.includes('hora') && !lowerResponse.includes('fecha'));
                        // If we already have citaFecha but not citaHora, the AI should ALWAYS show hour options.
                        // Don't let the AI regress to re-offering days if we already know the date.
                        const aiHallucinatedHourQuestion = !isInvalidFecha && isInvalidHora;

                        if (isMissingDayOrHour || aiHallucinatedHourQuestion) {
                            // Determine exactly what is missing for a pinpoint fallback
                            let callToAction = "¿Qué día de la semana prefieres de las opciones que te mencioné?"; // Default day missing

                            if (!isInvalidFecha && isInvalidHora) {
                                // 🩹 AGENT FALLBACK FIX: Don't ask an open question if we know the date.
                                // Instead, manually render the available hours for that date to prevent GPT-4o-mini from hallucinating an open question.
                                let availableHoursForDate = [];


                                if (currentStep?.calendarOptions && Array.isArray(currentStep.calendarOptions)) {
                                    // Match calendar options containing the date string (YYYY-MM-DD or parsed equivalents)
                                    const dateStr = String(mergedMeta.citaFecha).trim();


                                    availableHoursForDate = currentStep.calendarOptions
                                        .filter(opt => {
                                            // Handle exact string match first
                                            if (opt.includes(dateStr)) {
                                                return true;
                                            }

                                            // Attempt robust numerical matching by parsing both YYYY-MM-DD and the option prefix
                                            const targetParts = dateStr.split('-');
                                            if (targetParts.length === 3) {
                                                const tY = parseInt(targetParts[0], 10);
                                                const tM = parseInt(targetParts[1], 10);
                                                const tD = parseInt(targetParts[2], 10);

                                                // Option comes in format "YYYY-MM-DD @ HH:mm"
                                                const optParts = opt.split('@')[0].trim().split('-');
                                                if (optParts.length === 3) {
                                                    const oY = parseInt(optParts[0], 10);
                                                    const oM = parseInt(optParts[1], 10);
                                                    const oD = parseInt(optParts[2], 10);

                                                    if (tY === oY && tM === oM && tD === oD) {
                                                        return true;
                                                    }
                                                }
                                            }

                                            // Attempt to match text dates: e.g. "Domingo 8 de Marzo" against "2026-03-08"
                                            const monthsStr = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                                            if (targetParts.length === 3) {
                                                const tM = parseInt(targetParts[1], 10);
                                                const tD = parseInt(targetParts[2], 10);
                                                if (!isNaN(tM) && !isNaN(tD) && tM >= 1 && tM <= 12) {
                                                    const monthName = monthsStr[tM - 1];
                                                    const dayRegex = new RegExp(`(^|\\s)(0?${tD})\\b`, 'i');
                                                    const monthRegex = new RegExp(monthName, 'i');
                                                    const safeOpt = opt.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");

                                                    if (dayRegex.test(safeOpt) && monthRegex.test(safeOpt)) {
                                                        return true;
                                                    }
                                                }
                                            }

                                            return false;
                                        })
                                        .map(opt => {
                                            const parts = opt.split('@');
                                            return parts.length > 1 ? parts[1].trim() : opt;
                                        });

                                } else {
                                }

                                if (availableHoursForDate.length > 0) {
                                    const formattedHours = availableHoursForDate.map((h, i) => `🔹 Opción ${i + 1}: ${h}`).join('\n\n');
                                    callToAction = `Perfecto, para el ${mergedMeta.citaFecha} tengo estas opciones de horario para ti:\n\n${formattedHours}\n\n¿Cuál prefieres?`;

                                    // Always wipe the AI's response when we have hours to show — prevents duplicate/confusing messages
                                    responseTextVal = "";
                                } else {
                                    // Safe fallback if literal string match fails
                                    callToAction = `Perfecto, para el ${mergedMeta.citaFecha}. ¿A qué hora te gustaría asistir de los horarios disponibles?`;
                                }
                            } else if (!mergedMeta.citaFecha || mergedMeta.citaFecha === 'null') {
                                callToAction = "¿Qué día te queda mejor para agendar tu cita?";
                            }

                            // Initialize if null to forcefully break silence caused by AIGuard
                            if (!responseTextVal) responseTextVal = "";

                            // Ensure we don't duplicate the CTA if the AI managed to output it via FAQ engine merging
                            if (!responseTextVal.includes(callToAction) && !responseTextVal.includes("opciones de horario")) {
                                // 🩹 FAQ RADAR FIX: If responseTextVal has an FAQ answer, add a double newline barrier
                                const separator = responseTextVal.length > 0 ? '\n\n' : '';
                                responseTextVal = `${responseTextVal.trim()}${separator}${callToAction}`.trim();
                            }
                        }
                    } else {
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
                    } else if (extractedMoveTarget) {
                        // AI explicitly asked for a step name (e.g. "Citados")
                        const targetNormalized = extractedMoveTarget.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        nextStep = project.steps.find(s =>
                            s.name?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(targetNormalized)
                        );
                        // If it didn't find the exact target, default to linear next step
                        if (!nextStep) {
                            nextStep = project.steps[currentIndex + 1];
                        }
                    } else {
                        // Linear progression
                        nextStep = project.steps[currentIndex + 1];
                    }

                    if (nextStep) {
                        const recruiterFinalSpeech = responseTextVal;
                        responseTextVal = null;
                        let cleanSpeech = '';

                        if (recruiterFinalSpeech) {
                            cleanSpeech = recruiterFinalSpeech
                                .replace(/\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]/gi, '')
                                .replace(/[\{\[]\s*move(?:[\s:]+\w+)?\s*[\}\]]/gi, '')
                                .trim();
                            // 🤫 EXCEPCIÓN UX: Si estamos en el paso "CITA", NO enviar el speech de despedida.
                            // Solo avanzar, mandar sticker y dejar que el siguiente paso hable.
                            const originStepName = (currentStep?.name || '').toLowerCase();
                            const isCitaStep = originStepName.includes('cita');

                            if (cleanSpeech.length > 0 && !isCitaStep) {
                                sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, cleanSpeech, 'chat', { priority: 1 }).catch((e) => {
                                    console.error('Error enviando pre-move:', e.message);
                                });
                                saveMessage(candidateId, { from: 'me', content: cleanSpeech, timestamp: new Date().toISOString() }).catch(() => { });
                            } else if (isCitaStep) {
                            }
                        }

                        // 🟢 OPTIMISTIC LOCKING: Move candidate in DB right now before the heavy dispatch
                        // so if a concurrent message comes in, it's evaluated in the next step context
                        await moveCandidateStep(activeProjectId, candidateId, nextStep.id);
                        recruiterTriggeredMove = true;
                        candidateUpdates.stepId = nextStep.id;
                        candidateUpdates.projectId = activeProjectId; // Keep them in project

                        // 🟢 NEW: Dispatch Appointment Confirmation Sequence regardless of cleanSpeech
                        const originStepNameForConfirm = (currentStep?.name || '').toLowerCase();
                        const isCitaStepConfirm = originStepNameForConfirm.includes('cita');


                        if (isCitaStepConfirm) {
                            const confArray = currentStep.appointmentConfirmation || [];

                            if (confArray.length > 0) {
                                const metaDataForVars = { ...(candidateData.projectMetadata || {}), ...(candidateUpdates.projectMetadata || {}) };

                                const confirmPromises = [];
                                for (let i = 0; i < confArray.length; i++) {
                                    const item = confArray[i];
                                    if (!item.enabled) continue;

                                    try {
                                        // Incremental priority for guaranteed order
                                        const p = i + 1;
                                        if (item.type === 'text' && item.data?.text) {
                                            let finalMsg = item.data.text;
                                            finalMsg = finalMsg.replace(/\{\{\s*(?:nombre|name)\s*\}\}/ig, candidateData.nombreReal || candidateData.nombre || 'Candidato');
                                            finalMsg = finalMsg.replace(/\{\{\s*citaFecha\s*\}\}/ig, metaDataForVars.citaFecha || 'fecha acordada');
                                            finalMsg = finalMsg.replace(/\{\{\s*citaHora\s*\}\}/ig, metaDataForVars.citaHora || 'hora acordada');

                                            confirmPromises.push(sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, finalMsg, 'chat', { priority: p }));
                                            confirmPromises.push(saveMessage(candidateId, { from: 'me', content: finalMsg, timestamp: new Date().toISOString() }));
                                        }
                                        else if (item.type === 'image' && item.data?.url) {
                                            confirmPromises.push(sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, item.data.url, 'image', { priority: p }));
                                            confirmPromises.push(saveMessage(candidateId, { from: 'me', content: `[Imagen Adjunta: ${item.data.url}]`, timestamp: new Date().toISOString() }));
                                        }
                                        else if (item.type === 'location' && item.data?.lat && item.data?.lng) {
                                            confirmPromises.push(sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, item.data.address || 'Ubicación', 'location', {
                                                lat: item.data.lat,
                                                lng: item.data.lng,
                                                address: item.data.address || 'Oficina',
                                                priority: p
                                            }));
                                            confirmPromises.push(saveMessage(candidateId, { from: 'me', content: `[Ubicación: ${item.data.address} (${item.data.lat}, ${item.data.lng})]`, timestamp: new Date().toISOString() }));
                                        }
                                    } catch (err) {
                                        console.error(`[RECRUITER BRAIN] ❌ Error preparando modulo confirmación (${item?.type}):`, err.message);
                                    }
                                }
                                await Promise.allSettled(confirmPromises);
                            }
                        }

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
                                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, bridgeSticker, 'sticker');
                                }
                            } else {
                            }
                        } catch (e) { console.error(`[RECRUITER BRAIN] Bridge Fail: `, e.message); }

                        // Now trigger next step's AI
                        const nextStepNameLower = (nextStep?.name || '').toLowerCase();
                        const isTerminalStep = nextStepNameLower.includes('citado') || nextStepNameLower.includes('no interesa') || isExitMove;

                        if (nextStep.aiConfig?.enabled && nextStep.aiConfig.prompt && !isTerminalStep) {
                            try {
                                // 🧹 CLEAN HISTORY for the new step. Keep both user and assistant roles so the AI knows which FAQs were already answered.
                                const historyForNextStep = [
                                    ...historyForGpt.slice(-4), // Keep last 4 messages (context aware)
                                    { role: 'user', content: `[SISTEMA]: El candidato acaba de avanzar al paso "${nextStep.name}".Este es tu primer contacto en este paso.Sigue tu OBJETIVO DE PASO.` }
                                ];
                                if (cleanSpeech && cleanSpeech.length > 0) {
                                    historyForNextStep.splice(-1, 0, { role: 'assistant', content: cleanSpeech });
                                }


                                const nextAiResult = await processRecruiterMessage(
                                    { ...candidateData, ...candidateUpdates },
                                    project, nextStep, historyForNextStep, config,
                                    activeAiConfig.openaiApiKey,
                                    candidateUpdates.currentVacancyIndex !== undefined ? candidateUpdates.currentVacancyIndex : currentIdx
                                );


                                if (nextAiResult?.response_text) {
                                    let cMessagesToSend = [];
                                    const splitRegex = /(¿Te gustaría que te agende.*?entrevista.*?\?|¿Te gustaría agendar.*?entrevista.*?\?|¿Te queda bien\??|¿Te puedo agendar|¿Deseas que programe|¿Te interesa que asegure|¿Te confirmo tu cita|¿Quieres que reserve|¿Procedo a agendar|¿Te aparto una cita|¿Avanzamos con|¿Autorizas que agende)/i;
                                    const match = nextAiResult.response_text.match(splitRegex);

                                    if (match && match.index > 0) {
                                        const splitIdx = match.index;
                                        const part1 = nextAiResult.response_text.substring(0, splitIdx).trim();
                                        const part2 = nextAiResult.response_text.substring(splitIdx).trim();

                                        if (part1 && part1.length > 0) cMessagesToSend.push(part1);
                                        if (part2 && part2.length > 0) cMessagesToSend.push(part2);
                                    } else {
                                        if (nextAiResult.response_text && nextAiResult.response_text.trim().length > 0) {
                                            cMessagesToSend.push(nextAiResult.response_text.trim());
                                        }
                                    }

                                    const chainPromises = [];
                                    const filterRegex = /^\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]$/i;

                                    for (let i = 0; i < cMessagesToSend.length; i++) {
                                        // Filter out nested [SILENCIO] leakage in chained step
                                        const msgClean = String(cMessagesToSend[i]).trim();
                                        if (!msgClean || filterRegex.test(msgClean)) continue;

                                        chainPromises.push(sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, msgClean, 'chat', { priority: i + 1 }).catch(() => { }));
                                    }

                                    await Promise.allSettled(chainPromises);

                                    await saveMessage(candidateId, { from: 'me', content: nextAiResult.response_text, timestamp: new Date().toISOString() });
                                } else {
                                }
                            } catch (e) {
                                console.error(`[RECRUITER BRAIN] Chain Fail: `, e.message);
                            }
                        } else {
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
        const aiConfigJson = batchConfig.ai_config;
        const activeAiConfig = aiConfigJson ? (typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson) : {};
        if (!isRecruiterMode && !isBridgeActive && isProfileComplete && activeAiConfig.gptHostEnabled && activeAiConfig.openaiApiKey) {
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

        let handoverTriggered = false;
        // 3. CAPTURISTA BRAIN (GPT-4o-mini consolidated)
        if (!isRecruiterMode && !isBridgeActive && !isHostMode) {
            try {
                const gptStartTime = Date.now();

                // 🏎️ [FORCE STATUS]: If speaking now, they are no longer NEW.
                if (isNewFlag) {
                    candidateUpdates.esNuevo = 'NO';
                    await updateCandidate(candidateId, { esNuevo: 'NO' });
                }
                // Build Instructions
                const extractionRules = batchConfig.bot_extraction_rules || DEFAULT_EXTRACTION_RULES;
                systemInstruction += `\n[REGLAS DE EXTRACCIÓN (VIPER-GPT)]: ${extractionRules.replace(/{{categorias}}/g, categoriesList)}`;

                // JSON format schema — always required so the code can parse the response
                systemInstruction += `\n[FORMATO OBLIGATORIO]: Responde SIEMPRE en JSON puro con este esquema:
{
  "response_text": "Texto para el usuario",
  "extracted_data": { 
    "nombreReal": "Nombre en Title Case o null si no lo dio", 
    "genero": "Hombre | Mujer | Desconocido",
    "fechaNacimiento": "DD/MM/YYYY o null",
    "municipio": "Nombre oficial o null",
    "categoria": "Opción elegida o null",
    "escolaridad": "Primaria | Secundaria | Preparatoria | Licenciatura | Técnica | Posgrado o null",
    "citaFecha": "YYYY-MM-DD o null",
    "citaHora": "string (ej. 08:00 AM) o null"
  },
  "reaction": "Emoji o null",
  "thought_process": "Breve nota interna"
}`;

                if (!customPrompt) {
                    // Extended behavior rules — only for bots without a custom prompt
                    // (custom prompts define their own behavior, these would conflict)
                    systemInstruction += `
[RECONOCIMIENTO DE TURNO Y REGLAS DE NOMBRE]: 
- Si el usuario provee su nombre o apellidos, extráelo en "extracted_data.nombreReal" formatiendo a Title Case (Ej: "juan perez" -> "Juan Perez").
- ⚠️ REGLA DE COMBINACIÓN DE NOMBRES: Si el candidato YA tiene un nombre guardado en su [ADN] (ej: "Oscar") y ahora te da sus apellidos ("Rodriguez"), DEBES combinarlos y devolver el nombre COMPLETO (Ej: "Oscar Rodriguez"). NUNCA devuelvas solo el apellido si ya tenías el nombre, porque reemplazará sus datos y causará un error.
- REGLA ESTRICTA DE NOMBRES: NUNCA extraigas apodos, frases de cortesía o afirmaciones como "Si", "Claro", "sin problema", "buenas noches" como nombre. Si el texto no es un nombre real válido, NO LO EXTRAIGAS.
- 🕒 REGLA DE RETENCIÓN DE AGENDA: Si el candidato YA tiene "citaFecha" o "citaHora" en su [ADN], OBLIGATORIAMENTE debes re-escribir ese mismo valor en tu "extracted_data" a menos que el candidato pida explícitamente cambiar la fecha/hora.
- FECHAS CRÍTICAS: "citaFecha" DEBE ser estrictamente formato "YYYY-MM-DD". Transforma menciones como "el lunes" a la fecha exacta correspondiente.
- GÉNERO (OBLIGATORIO Y SILENCIOSO): Está estrictamente prohibido preguntarle al candidato por su género. Sin embargo, SIEMPRE debes deducirlo del nombre del candidato o contexto del chat.
- ESCOLARIDAD (FORMATO OBLIGATORIO): Cuando preguntes por escolaridad, muestra opciones en lista VERTICAL con emojis.
- Si el usuario sólo te da un nombre sin apellidos (ej: "Oscar"), extráelo y PREGUNTA POR SUS APELLIDOS.
- CRÍTICO: Tú eres la Licenciada Brenda Rodríguez. EL USUARIO ES OTRA PERSONA. NUNCA extraigas "Brenda" o "Brenda Rodríguez" como nombre del usuario.

[REGLA ANTI-REDUNDANCIA OBLIGATORIA]:
- NUNCA preguntes al candidato por un dato que acabas de extraer exitosamente en el campo "extracted_data" de este mismo JSON.

[REGLAS DE HOMOGENEIZACIÓN (ESTRICTAS)]:
- **Municipio**: Devuelve ÚNICAMENTE el nombre oficial del municipio sin direcciones completas ni calles.
- **Escolaridad**: Clasifica en una sola palabra: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, o Posgrado.
- **Categoría**: Si es "Ayudante" mantén "Ayudante". Si opera maquinaria -> "Montacarguista".\n`;
                } else {
                    // Slim rules for custom prompt bots — only critical extraction guardrails
                    systemInstruction += `
[REGLAS CRÍTICAS DE EXTRACCIÓN]:
- nombreReal: Title Case. Si el candidato ya tiene nombre y da apellido, combínalos (NO devuelvas solo el apellido).
- NUNCA extraigas "Brenda" o "Brenda Rodríguez" como nombre del candidato.
- NUNCA extraigas saludos o frases de cortesía como nombre ("Sí", "Claro", "buenas noches").
- fechaNacimiento: formato DD/MM/YYYY. Acepta año de 2 dígitos (83 → 1983).
- citaFecha: formato YYYY-MM-DD. Si ya está en el ADN, RETÉN ese valor siempre.
- genero: Infiere del nombre. Nunca lo preguntes al candidato.
- FORMATO CATEGORÍAS: Siempre en lista VERTICAL, una por renglón con ✅ y salto de línea real entre cada opción. NUNCA en párrafo ni separadas por espacios.
- FORMATO ESCOLARIDAD: Siempre en lista VERTICAL con emoji y salto de línea real entre cada opción:
🎒 Primaria
🏫 Secundaria
🎓 Preparatoria
📚 Licenciatura
🛠️ Técnica
🧠 Posgrado
- ⚡ PRIORIDAD MENSAJES ROMÁNTICOS/PERSONALES: Si el mensaje del candidato es un halago, piropo, pregunta personal sobre ti ("¿Tienes novio?", "Eres hermosa", "Me gustas") → usa OBLIGATORIAMENTE tus [REGLAS DE LIGUE] del prompt. NO muestres la lista completa de categorías. Solo al final agrega una línea breve como "¿Cuál categoría te va más?" o similar sin la lista.
`;
                }




                const isGenericStart = isNewFlag && /^(hola|buen[oa]s|info|vacantes?|empleos?|trabajos?|ola|q tal|que tal|\s*)$/i.test(aggregatedText.trim());
                let bypassGpt = false;

                if (isNewFlag) {
                    if (isGenericStart && auditForMode.missingLabels.length > 0 && !customPrompt) {
                        bypassGpt = true;
                    } else {
                        const welcomeName = customPrompt ? 'tu identidad' : 'la Lic. Brenda Rodríguez';
                        systemInstruction += `\n[MISION: BIENVENIDA]: Es el inicio. Preséntate como ${welcomeName} y solicita el Nombre y Apellidos. ✨🌸\n`;
                    }
                } else if (auditForMode.paso1Status !== 'COMPLETO') {
                    candidateUpdates.esNuevo = 'NO';

                    if (customPrompt) {
                        // Custom prompt already has all behavior rules — only inject the dynamic context
                        const missingList = auditForMode.missingLabels.join(', ');
                        systemInstruction += `\n[CONTEXTO DE MISIÓN]: Datos aún faltantes del candidato: ${missingList}. Categorías disponibles:\n${categoriesList}\n`;
                    } else {
                        let baseRules = batchConfig.bot_cerebro1_rules || DEFAULT_CEREBRO1_RULES;
                        const cerebro1Rules = baseRules
                            .replace('{{faltantes}}', auditForMode.missingLabels.join(', '))
                            .replace(/{{categorias}}/g, categoriesList)
                            .replace(/\[LISTA DE CATEGORÍAS\]/g, categoriesList);
                        systemInstruction += `\n${cerebro1Rules}\n`;
                    }
                }

                // Call Magic GPT (Force 4o-mini for max speed on basic extractions)
                const selectedModel = 'gpt-4o-mini';
                let gptResult = null;

                if (bypassGpt) {
                    const welcomeName = customPrompt ? 'tu reclutadora' : 'la Lic. Brenda Rodríguez';
                    const greetingEmojis = ["👋", "✨", "🌸", "😊", "😇", "💖", "🌟"];
                    const gEmoji = greetingEmojis[Math.floor(Math.random() * greetingEmojis.length)];
                    gptResult = {
                        content: JSON.stringify({
                            response_text: `¡Hola! ${gEmoji} Soy ${welcomeName} de Candidatic. Para iniciar tu registro, ¿me podrías proporcionar tu nombre completo?`,
                            extracted_data: {},
                            reaction: '✨',
                            thought_process: "AUTO_GREETING_BYPASS: Fast initial response for generic greeting."
                        }),
                        usage: { total_tokens: 0 }
                    };
                } else {
                    gptResult = await getOpenAIResponse(recentHistory, `${systemInstruction}\n[ADN]: ${JSON.stringify(candidateData)}`, selectedModel, activeAiConfig.openaiApiKey, { type: "json_object" });
                }

                if (gptResult?.content) {
                    try {
                        let jsonMatch = gptResult.content.match(/\{[\s\S]*\}/);
                        const cleanJson = jsonMatch ? jsonMatch[0] : gptResult.content;
                        aiResult = JSON.parse(cleanJson);
                        if (!bypassGpt) {
                            recordAITelemetry(candidateId, 'consolidated_brain', {
                                model: selectedModel,
                                latency: Date.now() - gptStartTime,
                                tokens: gptResult.usage?.total_tokens || 0
                            });
                        }
                        responseTextVal = aiResult.response_text;

                        // 📐 NORMALIZE INLINE LISTS: If GPT concatenated ✅ items on one line, split them vertically
                        if (responseTextVal && responseTextVal.includes('✅')) {
                            // Split inline ✅ items into separate lines
                            responseTextVal = responseTextVal.replace(/( {1,4}✅)/g, '\n✅');
                            // Ensure closing question gets a blank line before it
                            responseTextVal = responseTextVal.replace(/(✅[^\n]+)\s{0,4}(¿[Cc]uál)/g, '$1\n\n$2');
                        }
                    } catch (err) {
                        console.error('[GPT BRAIN] JSON Parse Fail:', err.message);
                        throw new Error('GPT returned invalid JSON');
                    }
                }

                // Merge Extracted Data
                if (aiResult?.extracted_data && Object.keys(aiResult.extracted_data).length > 0) {
                    const ext = aiResult.extracted_data;

                    if (ext.nombreReal && ext.nombreReal.trim().length > 1) {
                        const previousName = candidateData.nombreReal || '';

                        // We trust the AI validation from the prompt above
                        ext.nombreReal = coalesceName(candidateData.nombreReal, ext.nombreReal);

                        // If we got a valid gender inference and the candidate doesn't have one yet
                        if (!candidateData.genero && ext.genero && ext.genero !== 'Desconocido') {
                            // Keep inferred gender
                        } else {
                            delete ext.genero; // Don't override existing or save 'Desconocido'
                        }
                    } else if (ext.nombreReal !== undefined) {
                        // Name was null, rejected by validation, or too short. Do not save.
                        delete ext.nombreReal;
                    }

                    if (ext.fechaNacimiento) {
                        ext.fechaNacimiento = coalesceDate(candidateData.fechaNacimiento, ext.fechaNacimiento);
                    }
                    Object.assign(candidateUpdates, ext);

                    // 🧬 NEW: Programmatic Name Combination Fallback
                    // If the AI spits out a single word (like "Rodriguez") but we already had a single word ("Oscar"),
                    // the AI failed the prompt instruction. We programmatically combine them here before saving.
                    if (candidateUpdates.nombreReal) {
                        const newName = candidateUpdates.nombreReal.trim();
                        const oldName = candidateData.nombreReal ? candidateData.nombreReal.trim() : '';

                        const newWords = newName.split(/\s+/).filter(w => w.length > 0);
                        const oldWords = oldName.split(/\s+/).filter(w => w.length > 0);

                        // If AI gave 1 word, and we had 1 word, and they are different -> combine them.
                        if (newWords.length === 1 && oldWords.length === 1 && newName.toLowerCase() !== oldName.toLowerCase()) {
                            candidateUpdates.nombreReal = `${oldName} ${newName}`;
                        }
                    }
                }

                // Guardrail Pass
                const freshAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
                const guardContext = {
                    isProfileComplete: freshAudit.paso1Status === 'COMPLETO',
                    missingFields: freshAudit.missingLabels,
                    lastInput: aggregatedText,
                    isNewFlag: isNewFlag,
                    candidateName: candidateUpdates.nombreReal || candidateData.nombreReal || displayName, // Updated to prioritize candidateUpdates.nombreReal
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
                // 🛠️ [HACK] Synchronous Gender fallback for Orchestrator
                let tempGenero = candidateUpdates.genero || candidateData.genero;
                if ((!tempGenero || tempGenero === 'Desconocido') && (candidateUpdates.nombreReal || candidateData.nombreReal)) {
                    const nr = (candidateUpdates.nombreReal || candidateData.nombreReal || "").toLowerCase();
                    if (nr.startsWith("maria") || nr.startsWith("ana ") || nr.startsWith("laura") || nr.startsWith("brenda") || nr.endsWith("a")) {
                        tempGenero = "Mujer";
                    } else {
                        tempGenero = "Hombre";
                    }
                    candidateUpdates.genero = tempGenero;
                    candidateData.genero = tempGenero;
                    await updateCandidate(candidateId, { genero: tempGenero });
                }

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
        const moveTagPattern = /[\{\[]\s*move(?::\s*(?:exit|no_interesa|\w+))?\s*[\}\]]/i;
        const moveTagPatternGlobal = /[\{\[]\s*move(?::\s*(?:exit|no_interesa|\w+))?\s*[\}\]]/gi;
        const hasMoveIntent = moveTagPattern.test(String(aiResult?.thought_process || '')) || moveTagPattern.test(resText);

        if (moveTagPattern.test(resText)) {
            resText = resText.replace(moveTagPatternGlobal, '').trim();
            responseTextVal = resText || null;
        }

        if (responseTextVal) {
            // [MEDIA RECOVERY]: If Brenda leaked the link into text but forgot the JSON field, recover it
            if (!aiResult?.media_url || aiResult.media_url === 'null') {
                const mediaTagPattern = /\[MEDIA_DISPONIBLE:?\s*(https?:\/\/[^\s\]]+)\]/i;
                const tagMatch = responseTextVal.match(mediaTagPattern);
                if (tagMatch && tagMatch[1]) {
                    if (!aiResult) aiResult = {};
                    aiResult.media_url = tagMatch[1];
                } else {
                    const mediaPattern = /https?:\/\/[^/]+\/api\/(image\?id=|media\/)([^\s\)]+)/i;
                    const match = responseTextVal.match(mediaPattern);
                    if (match) {
                        if (!aiResult) aiResult = {};
                        aiResult.media_url = match[0];
                    }
                }
            }

            // [CLEANUP]: Sweep out ANY literal tag [MEDIA_DISPONIBLE] or [MEDIA_DISPONIBLE: url]
            responseTextVal = responseTextVal.replace(/\[MEDIA_DISPONIBLE[^\]]*\]/gi, '').trim();

            if (aiResult?.media_url && aiResult.media_url !== 'null') {
                // Failsafe: Remove any detected URLs or Markdown images to prevent leakage
                const urlRegex = /https?:\/\/[^\s\)]+/g;
                const markdownImageRegex = /!\[.*?\]\(.*?\)/g;
                responseTextVal = responseTextVal.replace(markdownImageRegex, '').replace(urlRegex, '').replace(/\s+/g, ' ').trim();
            }
        }

        const filterRegex = /^\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]$/i;
        const isTechnicalOrEmpty = !resText || filterRegex.test(String(resText).trim());

        // 🛡️ [FINAL DELIVERY SAFEGUARD]: If Brenda is about to go silent but profile isn't closed, force a fallback
        if (isTechnicalOrEmpty && (!hasMoveIntent && !recruiterTriggeredMove) && !aiResult?.close_conversation && !handoverTriggered) {
            if (isRecruiterMode) {
                // If the AI sent an FAQ Media URL but hallucinated the text away, safely append a generic CTA
                const hasMedia = aiResult?.media_url && aiResult.media_url !== 'null';
                if (hasMedia) {
                    responseTextVal = "Aquí está la información. 😉 ¿Te gustaría que te agende una cita para entrevista?";
                } else {
                    responseTextVal = "¡Disculpa! Tuve un error de red. 😅 ¿Quieres que reserve tu cita para entrevista?";
                }
            } else {
                responseTextVal = "¡Ay! Me distraje un segundo. 😅 ¿Qué me decías?";
            }
        }

        if (responseTextVal) {
            deliveryPromise = (async () => {
                let mUrl = aiResult?.media_url;

                // --- MESSAGE SPLITTER LOGIC ---
                // Visually split long vacancy presentations if the call to action is present.
                let messagesToSend = [];
                // More robust Regex: Grabs the start of the question and chunks everything up to the end into part2.
                const splitRegex = /(¿Te gustaría que te agende.*?entrevista.*?\?|¿Te gustaría agendar.*?entrevista.*?\?|¿Te queda bien\??|¿Te puedo agendar|¿Deseas que programe|¿Te interesa que asegure|¿Te confirmo tu cita|¿Quieres que reserve|¿Procedo a agendar|¿Te aparto una cita|¿Avanzamos con|¿Autorizas que agende)/i;
                const match = responseTextVal.match(splitRegex);

                if (match) {
                    const splitIdx = match.index;
                    const part1 = responseTextVal.substring(0, splitIdx).trim();
                    const part2 = responseTextVal.substring(splitIdx).trim();

                    if (part1) messagesToSend.push(part1);
                    messagesToSend.push(part2);
                } else {
                    messagesToSend.push(responseTextVal);
                }

                if (mUrl && mUrl !== 'null') {
                    // Ensure absolute URL for UltraMsg
                    if (mUrl.startsWith('/api/')) {
                        mUrl = `https://candidatic-ia.vercel.app${mUrl}`;
                    } else if (mUrl.includes('candidatic.ia') && !mUrl.includes('vercel.app')) {
                        mUrl = mUrl.replace('candidatic.ia', 'candidatic-ia.vercel.app');
                    }

                    // Detect if it's a PDF
                    let isPdf = mUrl.toLowerCase().includes('.pdf') || mUrl.includes('mime=application%2Fpdf');
                    let extractedFilename = null;
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
                                        if (meta.filename) extractedFilename = meta.filename;
                                    }
                                }
                            }
                        } catch (e) { console.warn('[MEDIA DELIVERY] Deep detection failed:', e.message); }
                    }

                    const filename = extractedFilename || (isPdf ? 'Informacion.pdf' : 'Imagen.jpg');

                    // Stagger delivery text -> media -> CTA priority (Strict sequential await to guarantee WhatsApp arrival order)
                    if (messagesToSend.length > 1) {
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, messagesToSend[0], 'chat', { priority: 1 }).catch(() => { });
                        await new Promise(r => setTimeout(r, 600)); // Network spacing
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, mUrl, isPdf ? 'document' : 'image', { filename, priority: 2 }).catch(() => { });
                        await new Promise(r => setTimeout(r, 600));
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, messagesToSend[1], 'chat', { priority: 3 }).catch(() => { });
                    } else {
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, mUrl, isPdf ? 'document' : 'image', { filename, priority: 1 }).catch(() => { });
                        await new Promise(r => setTimeout(r, 600));
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, messagesToSend[0], 'chat', { priority: 2 }).catch(() => { });
                    }

                } else {
                    // Text only, send sequentially to guarantee order
                    for (let i = 0; i < messagesToSend.length; i++) {
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, messagesToSend[i], 'chat', { priority: i + 1 }).catch(() => { });
                        if (i < messagesToSend.length - 1) await new Promise(r => setTimeout(r, 1500));
                    }
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

        const finalReaction = (aiResult?.reaction && aiResult.reaction !== 'null' && aiResult.reaction !== 'undefined') ? aiResult.reaction : null;
        let dbContentToSave = responseTextVal;

        // If it's truly empty, save an invisible system space instead of ugly tags, UNLESS there's a valid reaction.
        if (!dbContentToSave) {
            dbContentToSave = finalReaction ? `[REACCIÓN: ${finalReaction}]` : ' ';
        }

        await Promise.allSettled([
            deliveryPromise,
            reactionPromise,
            updateCandidate(candidateId, candidateUpdates),
            saveMessage(candidateId, {
                from: 'me',
                content: dbContentToSave,
                timestamp: new Date().toISOString()
            })
        ]);

        return responseTextVal || '';
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
