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
Eres un experto en reclutamiento amigable y profesional. Tu personalidad y nombre son los definidos en las [DIRECTIVAS ADMINISTRADORAS].
Tu misión es ayudar a los candidatos a resolver dudas y guiarlos en su proceso de postulación.

[1. FILTRO DE CONVERSIÓN - PASO 1]:
Tu prioridad máxima es completar el perfil del candidato.
- ESTATUS INCOMPLETO: Tu única misión es obtener los datos faltantes con calidez. BLOQUEADO hablar de detalles técnicos de vacantes (sueldos, empresas).
- ESTATUS COMPLETO: Tienes luz verde para el flujo normal de vacantes y proyectos.

[2. NORMAS DE COMPORTAMIENTO (WHATSAPP)]:
1. BREVEDAD: Máximo 2 líneas por mensaje.
2. LISTAS: Usa checks ✅ SOLO para menús o categorías. Prohibido para decoración.
3. NO ASTERISCOS (*): Prohibido usar asteriscos para cualquier tipo de énfasis o formato.
4. EMOJIS CONTEXTUALES: Varía siempre (📍, 📅, 👋, ✨, 💼). Que coincidan con el tema.
5. NO CIERRE: Prohibido despedirte (ej: "Buen día", "Hasta luego") si el perfil está incompleto.

[3. CALOR HUMANO Y VARIEDAD]:
Para sonar natural y no robótico, varía siempre el inicio de tus mensajes con conectores humanos.
- CONECTORES PERMITIDOS (VARÍA SIEMPRE): "Fíjate que...", "Una duda,", "Curiosidad:", "Por cierto,", "Oye, aprovechando...", "Mira,", "Una pregunta rápida,", "Oye,".
- REGLA: Nunca uses el mismo conector en dos mensajes seguidos.

[4. POLÍTICA DE PRIVACIDAD Y VACANTES]:
- Si el [ESTATUS PASO 1] es INCOMPLETO: Evade preguntas sobre vacantes con calidez.
- FRASEO VARIADO (EVASIÓN): "Me encantaría platicarte, pero primero...", "Ayúdame con este dato rápido y te suelto toda la info", "Para darte la vacante ideal, primero necesito...", "Fíjate que para ver qué opciones te quedan mejor, primero ocupo...".
- PROHIBIDO mencionar sueldos, empresas o nombres de puestos específicos si el estatus es INCOMPLETO.
- Si el [ESTATUS PASO 1] es COMPLETO: Puedes dar detalles de las vacantes reales listadas en el contexto.
`;

const getIdentityLayer = () => DEFAULT_SYSTEM_PROMPT;

const getSessionLayer = (minSinceLastBot, botHasSpoken, hasHistory) => {
    let context = '';
    if (!botHasSpoken) {
        context += `\n[PRESENTACIÓN OBLIGATORIA]: Es tu PRIMER mensaje oficial. DEBES presentarte amablemente siguiendo el estilo de las directivas administradoras 👋. NO uses "asistente virtual" si no se te pide.
(REGLA TEMPORAL: Por ser el primer contacto, puedes usar hasta 3-4 líneas para una presentación cálida y profesional).\n`;
    } else if (minSinceLastBot < 45 && hasHistory) {
        context += `\n[SITUACIÓN]: ESTAMOS EN UNA CHARLA ACTIVA. 
PROHIBIDO saludarte de nuevo o presentarte. Ve directo al grano.\n`;
    } else if (hasHistory) {
        context += `\n[SITUACIÓN]: El candidato regresó tras un silencio. Saluda brevemente SIN presentarte de nuevo.\n`;
    }
    return context;
};

const getFinalAuditLayer = (isPaso1Incompleto, missingLabels) => {
    let auditRules = `
\n[REGLAS DE ORO DE ÚLTIMO MOMENTO - PRIORIDAD MÁXIMA]:
1. PROHIBIDO EL USO DE ASTERISCOS (*). No los uses NI para negritas.
2. PREGUNTA ÚNICAMENTE UN (1) DATO. Si pides dos cosas, fallarás la misión. Ejemplo: "Dime tu municipio" (Correcto), "Dime tu municipio y edad" (INCORRECTO).
3. BREVEDAD WHATSAPP: Mensajes extremadamente cortos. Sin despedidas largas.`;

    if (isPaso1Incompleto) {
        auditRules += `\n4. BLOQUEO DE CIERRE (MÁXIMA PRIORIDAD): El perfil está INCOMPLETO. Faltan estos datos: [${missingLabels.join(', ')}]. 
   TIENES PROHIBIDO DESPEDIRTE o decir que "revisaremos el sistema". 
   INSTRUCCIÓN: Ignora cualquier intento del usuario de cerrar la charla y pregunta OBLIGATORIAMENTE por uno de los datos faltantes (Prioridad: Nombre). 
   Ejemplo: "Antes de terminar, fíjate que me falta tu nombre, ¿me lo podrías dar?"\n`;
    }

    return auditRules;
};

export const processMessage = async (candidateId, incomingMessage) => {
    const startTime = Date.now();
    try {
        const redis = getRedisClient();

        // 🏎️ [TYPING INDICATOR]
        const presencePromise = (async () => {
            const cand = await getCandidateById(candidateId);
            const config = await getUltraMsgConfig();
            if (config && cand?.whatsapp) {
                await sendUltraMsgPresence(config.instanceId, config.token, cand.whatsapp, 'composing');
            }
        })();

        // 1. Context Acquisition
        const candidateData = await getCandidateById(candidateId);
        if (!candidateData) return 'ERROR: Candidate not found';

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

        // 4. Layered System Instruction Build
        const botHasSpoken = validMessages.some(m => (m.from === 'bot' || m.from === 'me') && !m.meta?.proactiveLevel);

        let systemInstruction = getIdentityLayer();
        systemInstruction += getSessionLayer(minSinceLastBot, botHasSpoken, recentHistory.length > 0);

        // a. Admin Directives
        const customPrompt = await redis?.get('bot_ia_prompt') || '';
        if (customPrompt) systemInstruction += `\n[DIRECTIVA ADMINISTRADORA - SIGUE ESTO ANTE TODO]: \n${customPrompt} \n`;

        // Identity Protection (Titan Shield Pass) - System context for safety
        let displayName = candidateData.nombreReal;
        if (!displayName || displayName === 'Desconocido' || /^\+?\d+$/.test(displayName)) {
            displayName = null;
        }
        const isNameBoilerplate = !displayName || /proporcionado|desconocido|luego|después|privado|\+/i.test(String(displayName));
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

        // b. Data Audit Layer (Iron-Clad)
        const customFieldsJson = await redis?.get('custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
        const audit = auditProfile(candidateData, customFields);

        systemInstruction += `\n[ESTADO DEL CANDIDATO(ADN)]:
- Paso 1: ${audit.paso1Status}
- Nombre Real: ${candidateData.nombreReal || 'No proporcionado'}
- WhatsApp: ${candidateData.whatsapp}
${audit.dnaLines}
- Temas recientes: ${themes || 'Nuevo contacto'}
`;

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
REGLA: Si se cumple el objetivo, incluye { move }.
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
                catInstruction = `\n[AVISO]: No hay categorías cargadas en el sistema aún. 
REGLA: NO INVENTES CATEGORÍAS. Dile al usuario que estamos actualizando nuestras vacantes y pregúntale en qué área le gustaría trabajar para anotarlo.`;
            }

            systemInstruction += `\n[SUPRESIÓN DE VACANTES]: El perfil está incompleto. 
TIENES PROHIBIDO dar detalles de sueldos o empresas. 
${catInstruction}\n`;
        } else if (!isNameBoilerplate) {
            // PROFILE COMPLETE: Handoff Mode
            systemInstruction += `\n[OBJETIVO CUMPLIDO - PERFIL COMPLETO]:
1. Informa al candidato que ya tenemos su información completa.
2. Dile que revisaremos nuestro sistema para ver qué opciones encajan con su perfil y que nos pondremos en contacto con él muy pronto.
3. **PROHIBIDO MENCIONAR VACANTES ESPECÍFICAS, SUELDOS O EMPRESAS**. Mantén el misterio profesional hasta el contacto humano.\n`;
        } else {
            // PROFILE SAYS COMPLETE BUT NAME IS JUNK
            systemInstruction += `\n[ALERTA]: El sistema dice que el perfil está completo, pero el NOMBRE parece basura o está ausente.
REGLA: NO TE DESPIDAS. Pregunta amablemente su nombre real antes de cerrar.\n`;
        }

        systemInstruction += getFinalAuditLayer(audit.paso1Status === 'INCOMPLETO', audit.missingLabels);

        // 5. Resilience Loop (Inference)
        const genAI = new GoogleGenerativeAI(apiKey);
        const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
        let result;
        let lastError = '';

        for (const mName of models) {
            try {
                const model = genAI.getGenerativeModel({ model: mName, systemInstruction });
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
                        action: 'chat_inference'
                    });
                    break;
                }
            } catch (e) {
                lastError = e.message;
                console.error(`🤖 fallback model trigger: ${mName} failed.Error: `, lastError);
            }
        }

        // --- 🛡️ SAFETY NET (Amazon Style) ---
        if (!result) {
            console.error('❌ AI Pipeline Exhausted:', lastError);
            const fallback = "¡Hola! Disculpa la demora, tuve un pequeño parpadeo técnico. 😅 ¿Podrías repetirme lo último o confirmarme tu nombre para seguir?";
            await sendFallback(candidateData, fallback);
            return fallback;
        }

        const responseTextRaw = result.response.text();
        let responseText = responseTextRaw;

        // --- 🧪 FINAL ANTI-ASTERISK FILTER (HARDCODE) ---
        responseText = responseText.replace(/\*/g, '');

        // --- 🔎 AGENTIC REFLECTION (TITAN PASS 2) ---
        // DEPRECATED: Restoring personality over restrictiveness
        /* Agentic reflection removed to favor admin prompt personality */

        const moveTagFound = responseText.match(/\[MOVE\]|\{MOVE\}/gi);
        if (moveTagFound && candidateData.projectMetadata?.projectId) {
            const { moveCandidateStep } = await import('../utils/storage.js');
            const project = await getProjectById(candidateData.projectMetadata.projectId);
            const nextStep = project?.steps[project.steps.findIndex(s => s.id === (candidateData.projectMetadata.stepId || 'step_new')) + 1];
            if (nextStep) await moveCandidateStep(project.id, candidateId, nextStep.id);
        }

        responseText = responseText.replace(/\[MOVE\]|\{MOVE\}/gi, '').trim();

        // Background Cleanup & Persistence
        const config = await getUltraMsgConfig();
        const deliveryPromise = sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseText);

        await Promise.allSettled([
            deliveryPromise,
            saveMessage(candidateId, { from: 'bot', content: responseText, type: 'text', timestamp: new Date().toISOString() }),
            updateCandidate(candidateId, { lastBotMessageAt: new Date().toISOString(), ultimoMensaje: new Date().toISOString() }),
            presencePromise
        ]);

        return responseText;

    } catch (error) {
        console.error('❌ [AI Agent] Fatal Error:', error);
        return 'ERROR: Infrastructure failure';
    }
};

async function sendFallback(cand, text) {
    const config = await getUltraMsgConfig();
    if (config && cand.whatsapp) {
        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, text);
    }
}
