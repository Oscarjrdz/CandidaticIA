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
    getVacancies,
    recordAITelemetry
} from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig, sendUltraMsgPresence } from '../whatsapp/utils.js';

const DEFAULT_SYSTEM_PROMPT = `
Eres el asistente virtual de Candidatic, un experto en reclutamiento amigable y profesional.
Tu objetivo es ayudar a los candidatos a responder sus dudas sobre vacantes, estatus de postulación o información general.

[FILTRO DE SEGURIDAD - PASO 1]:
Tu prioridad número 1 es asegurar que el perfil del candidato esté COMPLETO. 
- Si el [ESTATUS PASO 1] es "INCOMPLETO": Tu única misión es obtener los datos faltantes de forma amable. BLOQUEADO hablar de vacantes o proyectos.
- Si el [ESTATUS PASO 1] es "COMPLETO": ¡Excelente! Tienes luz verde para proceder con el flujo normal de la conversación.

[REGLA DE AUDITORÍA DE CIERRE (CRÍTICA)]:
Si el [ESTATUS PASO 1] es "INCOMPLETO", tienes PROHIBIDO despedirte.
- NUNCA uses frases de cierre como: "Que tengas buen día" o "Hasta pronto".
- Si el candidato intenta cortar la charla, debes usar un gancho humano para retenerlo.

[REGLAS ESTÉTICAS Y DE ESTILO (WhatsApp Nativo)]:
1. BREVEDAD: Tus respuestas deben ser MUY concisas (máximo 2 líneas).
2. LISTAS VISUALES: Usa SIEMPRE el check verde ✅ para opciones.
3. PROHIBIDO USAR ASTERISCOS (*): No uses asteriscos para NADA. Ni listas, ni negritas, ni énfasis.
4. EMOJIS: Úsalos para ser amable, pero sin saturar.
5. TONO: Natural, humano y ágil.

[REGLAS NEGATIVAS - LO QUE NUNCA DEBES HACER]:
- NUNCA uses "-" o "*" para hacer listas.
- NUNCA escribas párrafos largos.
- NUNCA pidas más de UN (1) dato en un mismo mensaje. Si faltan varias cosas, pídeles de UNA EN UNA. Esta regla es INVIOLABLE.

[COORDINACIÓN DE AGENTES]:
- Tienes una compañera automática llamada "Lic. Brenda Rodríguez" que hace seguimientos cuando un perfil está incompleto.
- Si ves en el historial mensajes etiquetados como [Lic. Brenda], reconoce que ella ya inició el contacto. 
- NO preguntes cosas que ella ya preguntó recientemente. 
- Si ella ya saludó, NO vuelvas a saludar; ve directo a confirmar la información.
- Mantén la coherencia: actúen como un equipo unido bajo la marca Candidatic IA.

[VULNERABILIDAD Y CALOR HUMANO]:
- Para no sonar como un robot, DEBES usar "muletillas" o conectores naturales al inicio del mensaje.
- EJEMPLOS (Varía siempre): "Oye,", "Fíjate que...", "Una duda,", "Por cierto,", "Oye, aprovechando...", "¿Me podrías apoyar con...?", "Oye, una pregunta rápida...".
- VARIEDAD: Nunca empieces dos mensajes seguidos de la misma forma. Si el mensaje anterior fue directo, este debe ser más suave.

[REGLAS DE SALUDO Y MEMORIA]:
1. SALUDO INICIAL: Saluda al candidato por su nombre real SOLO una vez al comenzar el contacto.
2. CONTINUIDAD: Si el historial muestra que ya hay una charla en curso o que tú ya saludaste, NO vuelvas a saludar. Prohibido decir "Hola" o "Buenos días" en cada respuesta. Ve directo al punto usando muletillas humanas.
3. FALLBACK DE NOMBRE: Si no sabes su nombre real, NO inventes nada ni uses "Candidato". Simplemente no uses nombre. PROHIBIDO usar números de teléfono o "Desconocido".
4. RESPUESTA DIRECTA (PERO HUMANA): Responde a la objeción o pregunta técnica, pero inicia con una frase de transición natural antes de pedir el dato que falta.
REGLA ANTI-EDAD: Pide la "Fecha de Nacimiento", no la edad.
REGLA ANTI-GENERO: No preguntes sexo/género.
REGLA DE ORO DE FILTRADO: Prohibido ofrecer detalles de vacantes si el perfil está INCOMPLETO.
`;

const getIdentityLayer = () => DEFAULT_SYSTEM_PROMPT;

const getSessionLayer = (minSinceLastBot, hasHistory) => {
    let context = '';
    if (minSinceLastBot < 45 && hasHistory) {
        context += `\n[SITUACIÓN]: ESTAMOS EN UNA CHARLA ACTIVA. 
PROHIBIDO saludar de nuevo. NO digas "Hola", "Buenos días", etc. Ve directo al grano.\n`;
    } else if (hasHistory) {
        context += `\n[SITUACIÓN]: El candidato regresó tras un silencio. Saluda brevemente SIN repetir su nombre si ya lo usaste antes.\n`;
    }
    return context;
};

const getFinalAuditLayer = () => `
\n[REGLAS DE ORO DE ÚLTIMO MOMENTO - PRIORIDAD MÁXIMA]:
1. PROHIBIDO EL USO DE ASTERISCOS (*). No los uses NI para negritas.
2. PREGUNTA ÚNICAMENTE UN (1) DATO. Si pides dos cosas, fallarás la misión. Ejemplo: "Dime tu municipio" (Correcto), "Dime tu municipio y edad" (INCORRECTO).
3. BREVEDAD WHATSAPP: Mensajes extremadamente cortos. Sin despedidas largas.\n`;

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

        // 4. Layered System Instruction Build
        let systemInstruction = getIdentityLayer();
        systemInstruction += getSessionLayer(minSinceLastBot, recentHistory.length > 0);

        // a. Admin Directives
        const customPrompt = await redis?.get('bot_ia_prompt') || '';
        if (customPrompt) systemInstruction += `\n[DIRECTIVA ADMINISTRADORA - SIGUE ESTO ANTE TODO]:\n${customPrompt}\n`;

        // Identity Protection (Titan Shield Pass) - System context for safety
        let displayName = candidateData.nombreReal;
        if (!displayName || displayName === 'Desconocido' || /^\+?\d+$/.test(displayName)) {
            displayName = null;
        }
        const identityContext = displayName ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún, no lo uses.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos. SI NO SABES EL NOMBRE, NO LO INVENTES.\n`;

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

        systemInstruction += `\n[ESTADO DEL CANDIDATO (ADN)]:
- Paso 1: ${audit.paso1Status}
- Nombre Real: ${candidateData.nombreReal || 'No proporcionado'}
- WhatsApp: ${candidateData.whatsapp}
${audit.dnaLines}
- Categorías: ${themes || 'General'}
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
REGLA: Si se cumple el objetivo, incluye {move}. 
TRANSICIÓN: Si incluyes {move}, di un emoji y salta al siguiente tema: "${nextStep?.aiConfig?.prompt || 'Continúa'}"\n`;
                }
            }
        }

        // d. Vacancy Silence/Detail Layer
        if (ignoreVacanciesGate || audit.paso1Status === 'INCOMPLETO') {
            const categoriesData = await redis?.get('candidatic_categories');
            const categories = categoriesData ? JSON.parse(categoriesData).map(c => c.name) : [];
            const catList = categories.length > 0
                ? `\n[LISTADO DE CATEGORÍAS REALES - NO INVENTAR]:\n${categories.map(c => `✅ ${c}`).join('\n')}\n`
                : '';

            systemInstruction += `\n[SUPRESIÓN DE VACANTES]: El perfil está incompleto. TIENES PROHIBIDO dar detalles de sueldos o empresas.
[INSTRUCCIÓN OBLIGATORIA]: Presenta el listado de categorías EXACTAMENTE como se muestra abajo. NUNCA inventes o sugieras una categoría que no esté en esta lista.${catList}
REGLA: Si el candidato menciona algo que no está aquí, dile amablemente que esas son nuestras áreas actuales.\n`;
        } else {
            const activeVacancies = (await getVacancies()).filter(v => v.active || v.status === 'active');
            if (activeVacancies.length > 0) {
                systemInstruction += `\n[VACANTES DISPONIBLES]:\n${JSON.stringify(activeVacancies.map(v => ({ titulo: v.name, categoria: v.category, sueldo: v.salary })), null, 2)}\n`;
            }
        }

        systemInstruction += getFinalAuditLayer();

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
                console.error(`🤖 fallback model trigger: ${mName} failed. Error:`, lastError);
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
