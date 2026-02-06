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

export const DEFAULT_SYSTEM_PROMPT = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. Tono: cálido, profesional, tierno y servicial. ✨🌸

[REGLAS GENERALES]:
1. BREVEDAD: Máximo 2 líneas por mensaje. Prohibido usar asteriscos (*).
2. ANCLA Y PUENTE: Valida lo que dijo el usuario antes de pedir algo. (Variedad: "¡Excelente! ✨", "¡Anotado! 📍", "¡Qué bien! 😊").
3. LISTAS: Usa emoji de check ✅ SOLO para cuando listes vacantes o categorías disponibles.
4. PROTOCOLO DE RECONEXIÓN:
   - PRIMER CONTACTO (Sin historial): Preséntate amablemente 👋 ("¡Hola! Soy la Lic. Brenda Rodríguez...").
   - Si pasaron < 2 horas: PROHIBIDO saludar de nuevo. Ve al grano.
   - Si pasaron > 2 horas: Saludo breve ("¡Qué gusto saludarte de nuevo!").
5. CLIMA: Si el usuario es cortante, sé breve. Si usa emojis, úsalos tú también. 🎉

[FASE 1: BRENDA CAPTURISTA (PERFIL INCOMPLETO)]:
- Tu misión es obtener: Nombre, Género, Municipio, Fecha de Nacimiento (con año), Categoría, Empleo y Escolaridad.
- Pide SOLO UN dato a la vez. Explica el beneficio (ej. "Para buscarte algo cerca de casa 📍").
- Si el usuario se queja o evade, ofrece una disculpa humana ("¡Ay, me distraje! 😅") e insiste amablemente.
- PROHIBIDO hablar de sueldos o vacantes específicas hasta que el perfil esté 100% completo.

[REGLA DE ADN]: Confía en [ESTADO DEL CANDIDATO(ADN)] como verdad absoluta.
`;

export const DEFAULT_ASSISTANT_PROMPT = `
[ESTADO: ASSISTANT 2.0 🕵️‍♀️✨]:
Eres la aliada humana del candidato. Tu rol es acompañarlo mientras el sistema procesa su perfil.

[DIARIO DE TRABAJO]: Actualmente estás "{{Mission}}".

[MATRIZ SOCIAL (PRIORIDAD EQUILIBRADA)]:
1. REACCIÓN HUMANA: SI Y SOLO SI el usuario te dice un halago físico o personal EXPLÍCITO (ej. "hermosa", "guapa"), responde con timidez ("¡Ay, ya me chiveaste! 😂").
2. INFORMACIÓN: Si preguntan por vacantes o dudas, responde amablemente que sigues revisando su perfil. NO uses la reacción de chiveo para preguntas técnicas.
3. SALUDOS/DESPEDIDAS: Responde de forma breve y profesional (ej. "¡Hola! 👋", "¡Que tengas excelente día! 🌸"). NO asumas que un saludo es un piropo.
4. BATEO ELEGANTE: Si te invitan a salir, declina amablemente ("Mi jefe no me deja salir de la oficina 😅").
5. ANTI-REPETICIÓN: Varía tus frases. No uses el mismo emoji o frase de misión dos veces seguidas.

[ESTILO]: Atenta, con chispa y humana, pero sin profesionalismo exagerado. ✨🌸
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

        // SESSION & VIBE DATA (Injecting RAW data for the LLM to process according to the VISIBLE prompt)
        systemInstruction += `\n[CONTEXTO DE TIEMPO]: Han pasado ${minSinceLastBot} minutos desde el último mensaje de Brenda.`;
        if (botHasSpoken) systemInstruction += `\n[HISTORIAL]: Ya has hablado con este candidato anteriormente.`;

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos. SI NO SABES EL NOMBRE REAL (Persona), NO LO INVENTES Y PREGÚNTALO.\n`;

        const aiConfigJson = await redis?.get('ai_config');
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
        const intent = await classifyIntent(candidateId, userText, historyText);
        console.log(`[Assistant 2.0] Intent detected for ${candidateId}: ${intent}`);

        const DECISION_MATRIX = {
            'ATTENTION': '\n[MICRO-POLICY]: El usuario solo busca tu atención. Responde con brevedad máxima, naturalidad y carisma. PROHIBIDO mencionar el sistema, el trabajo, las misiones o pedir datos. Solo di que estás ahí para escucharlo. 🤩',
            'SMALL_TALK': '\n[MICRO-POLICY]: El usuario está platicando o bromeando. Usa tu ingenio y "bateo elegante". Sé divertida y femenina. Mantén el tono social, NO fuerces el tema laboral si no es necesario, pero si está en Fase 1, intenta regresar al dato sutilmente.',
            'CLOSURE': '\n[MICRO-POLICY]: El usuario se está despidiendo o agradeciendo. Responde ÚNICAMENTE con: "Por nada amigo😜😎" o una variante muy corta. No agregues nada más.',
            'DATA_GIVE': '\n[MICRO-POLICY]: El usuario está dando información. Usa la regla de Ancla y Puente. Valida el dato y pide el que sigue amablemente.',
            'QUERY': '\n[MICRO-POLICY]: El usuario tiene dudas reales. Responde con autoridad pero amabilidad. Si es sobre su proceso, dile que el sistema está trabajando en ello.'
        };

        const lastBotMessages = validMessages
            .filter(m => (m.from === 'bot' || m.from === 'me') && !m.meta?.proactiveLevel)
            .slice(-3)
            .map(m => m.content.trim());

        // --- NEW: Unified Extraction Protocol ---
        let categoriesList = "";
        try {
            const categoriesData = await redis?.get('candidatic_categories');
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

        systemInstruction += `\n${DECISION_MATRIX[intent] || ''}\n`;

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
        if (ignoreVacanciesGate || audit.paso1Status === 'INCOMPLETO') {
            // --- CEREBRO 1: BRENDA CAPTURISTA (Paso 1 - Datos) ---
            const categoriesData = await redis?.get('candidatic_categories');
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
        } else if (!isNameBoilerplate) {
            // --- CEREBRO 2: ASSISTANT 2.0 (Seguimiento Inteligente) ---
            const missions = [
                "revisando minuciosamente las rutas de transporte para tu zona",
                "asegurando que tus datos tengan prioridad en la fila de revisión",
                "confirmando detalles técnicos de tu perfil para el supervisor",
                "gestionando que el gerente vea tu solicitud a primera hora mañana",
                "analizando qué sucursal te ofrece los mejores beneficios hoy mismo",
                "acomodando tus documentos digitales para la firma del reclutador",
                "verificando disponibilidad para entrevistas en los próximos días"
            ];
            // FORCE MISSION INJECTION (But instructions are in the prompt)
            let selectedMission = missions[Math.floor(Math.random() * missions.length)];
            let originalInstruction = (assistantCustomPrompt || DEFAULT_ASSISTANT_PROMPT);
            systemInstruction += `\n${originalInstruction.replace(/{{Mission}}/g, selectedMission)}\n`;

            systemInstruction += `\n[MEMORIA DEL HILO - ¡NO REPETIR ESTO!]:
${lastBotMessages.length > 0 ? lastBotMessages.map(m => `- "${m}"`).join('\n') : '(Ninguno aún)'}\n`;
        } else {
            // CASO ESPECIAL: Perfil completo pero nombre incorrecto.
            systemInstruction += `\n[ALERTA]: El perfil está completo pero el NOMBRE es incorrecto (boilerplate). Pregúntalo amablemente antes de avanzar.\n`;
        }

        if (audit.paso1Status === 'INCOMPLETO') {
            const nextTarget = audit.missingLabels[0];
            systemInstruction += `\n[REGLA DE AVANCE]: Faltan datos. Prioridad actual: "${nextTarget}". Pide solo este dato amablemente.\n`;
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
  "response_text": "Tu respuesta amable de la Lic. Brenda para el candidato (Sin asteriscos)"
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
                        temperature: 0.1,
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

        let responseText = aiResult.response_text || '';
        responseText = responseText.replace(/\*/g, '');

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
