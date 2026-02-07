import {
    getRedisClient,
    getMessages,
    getAIAutomations,
    getCandidates,
    saveMessage,
    getCandidateByPhone,
    incrementAIAutomationSentCount,
    updateCandidate,
    auditProfile,
    isProfileComplete,
    recordAITelemetry
} from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;

/**
 * Automation Engine - Brenda Proactive Follow-up
 * Last Deploy: 2026-02-07 09:15 MX
 */
export async function runAIAutomations(isManual = false, manualConfig = null) {
    const logs = [];
    let messagesSent = 0;
    let evaluatedCount = 0;
    let processedCount = 0;

    try {
        logs.push(`🚀[SYSTEM] Iniciando motor(Manual: ${isManual})`);

        // --- 0. MASTER TOGGLE CHECK ---
        const redis = getRedisClient();
        const isActive = await redis?.get('bot_ia_active');
        if (isActive === 'false' && !isManual) {
            logs.push(`🛑[SYSTEM] El Bot está APAGADO globalmente. Abortando motor.`);
            return { success: true, logs, sent: 0, reason: 'BOT_OFF' };
        }

        let geminiKey = process.env.GEMINI_API_KEY;

        if (!geminiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                geminiKey = aiConfig.geminiApiKey;
            }
        }

        if (!geminiKey || geminiKey === 'undefined' || geminiKey === 'null') {
            logs.push(`❌ CRITICAL: Falta GEMINI_API_KEY. Configure su API Key en Ajustes.`);
            return { success: false, error: 'GEMINI_API_KEY_MISSING', logs };
        }

        // Sanitize API Key
        geminiKey = String(geminiKey).trim().replace(/^["']|["']$/g, '');
        const keyMatch = geminiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (keyMatch) geminiKey = keyMatch[0];

        const config = await getUltraMsgConfig();
        if (!config?.instanceId || !config?.token) {
            logs.push(`❌ CRITICAL: UltraMsg no está vinculado(Falta Instance ID o Token).`);
            return { success: false, error: 'ULTRAMSG_CONFIG_MISSING', logs };
        }
        logs.push(`✅ Configuración y API Key verificadas.`);

        const genAI = new GoogleGenerativeAI(geminiKey);

        // Resilience: Try 2.0 then 1.5
        let model;
        try {
            model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            // Test if model exists/accessible (briefly)
            await model.countTokens("test");
        } catch (e) {
            logs.push(`⚠️ gemini-2.0-flash no disponible, usando fallback gemini-1.5-flash`);
            model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        }

        // --- NATIVE PROACTIVE FOLLOW-UP LOGIC (INDEPENDENT) ---
        const isProactiveEnabled = (await redis.get('bot_proactive_enabled')) === 'true';
        if (isProactiveEnabled) {
            logs.push(`🔍[PROACTIVE] Iniciando análisis de seguimiento...`);

            // Check Time Window (7 AM - 11 PM) - Force UTC-6 (Mexico)
            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const mxTime = new Date(utc + (3600000 * -6));
            const nowHour = mxTime.getHours();

            if (nowHour < 7 || nowHour >= 23) {
                logs.push(`💤[PROACTIVE] Fuera de horario permitido(7:00 - 23:00). Hora MX calculada: ${mxTime.toLocaleTimeString('es-MX')}`);
            } else {
                // Check Daily Limit
                const todayKey = `ai:proactive:count:${new Date().toISOString().split('T')[0]}`;
                const dailyCount = parseInt(await redis.get(todayKey) || '0');
                if (dailyCount >= 300) {
                    logs.push(`🛑[PROACTIVE] Límite diario alcanzado(300 / día).`);
                } else {
                    // Strictly follow the 1 message per minute rate limit
                    await processNativeProactive(redis, model, config, logs, todayKey, now, 1);
                }
            }
        }

        // --- PIPELINE DE RECLUTAMIENTO ---
        try {
            const pipeResult = await processProjectPipelines(redis, model, config, logs, manualConfig);
            processedCount = pipeResult?.sent || 0;
        } catch (e) {
            logs.push(`⚠️[PIPELINE] Error procesando embudos: ${e.message} `);
        }

        // --- OLD RULES ENGINE (LEGACY) ---
        // (Existing Logic)
        const rules = await getAIAutomations(redis);
        const activeRules = (rules || []).filter(a => a?.active && a?.prompt);

        if (activeRules.length === 0) {
            logs.push(`ℹ️ No se encontraron reglas activas para procesar.`);
            return { success: true, logs, processedCount };
        }
        logs.push(`📋 Procesando ${activeRules.length} reglas activas.`);

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
            logs.push(`----------------------------------- `);
            logs.push(`⚙️ Regla: "${rule.name || 'Sin nombre'}"`);

            // --- 2. SNIPER DETECTION ---
            let targetPhone = null;
            const phoneMatch = rule.prompt.match(/(\d{10,13})/);
            if (phoneMatch) {
                targetPhone = phoneMatch[0];
                logs.push(`🎯 Sniper detectado: ${targetPhone} `);
            }

            let candidates = [];
            if (targetPhone) {
                const c = await getCandidateByPhone(targetPhone);
                if (c) {
                    candidates = [c];
                    logs.push(`✅ Candidato identificado: ${c.nombre} `);
                } else {
                    logs.push(`⚠️ El número ${targetPhone} no existe en la base de datos.`);
                }
            } else {
                logs.push(`🧠 IA: Escaneando intención compleja...`);
                try {
                    const extra = await model.generateContent(`Extract phone / name from: "${rule.prompt}".JSON ONLY: { "p": null, "n": null } `);
                    const json = JSON.parse(extra.response.text().match(/\{[\s\S]*\}/)?.[0] || '{}');
                    if (json.p) {
                        const c = await getCandidateByPhone(json.p);
                        if (c) candidates = [c];
                    } else {
                        const { candidates: list } = await getCandidates(isManual ? 30 : 100, 0, json.n || '');
                        candidates = list || [];
                    }
                } catch (e) {
                    logs.push(`⚠️ IA Falló extracción: Usando escaneo reciente.`);
                    const { candidates: list } = await getCandidates(20, 0);
                    candidates = list || [];
                }
            }

            if (!candidates || candidates.length === 0) {
                logs.push(`⏭️ Sin candidatos para esta regla.`);
                continue;
            }

            // --- 3. EVALUATION ---
            for (const cand of candidates) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
                if (!cand?.id || !cand?.whatsapp) continue;

                if (!isManual) {
                    const last = await redis.get(`ai:automation:last:${cand.id}`);
                    if (last) {
                        logs.push(`⏭️[SKIP] ${cand.nombre} ya procesado por regla recientemente.`);
                        continue;
                    }
                }

                const now = new Date();
                const lastUserMsg = cand.lastUserMessageAt ? new Date(cand.lastUserMessageAt) : null;
                const lastBotMsg = cand.lastBotMessageAt ? new Date(cand.lastBotMessageAt) : null;

                // Calculate inactivity in minutes
                const minSinceLastUser = lastUserMsg ? Math.floor((now - lastUserMsg) / 60000) : 999;
                const minSinceLastBot = lastBotMsg ? Math.floor((now - lastBotMsg) / 60000) : 999;

                evaluatedCount++;
                try {
                    logs.push(`🤔 Evaluando a ${cand.nombre} (Inactividad Usuario: ${minSinceLastUser} m, Bot: ${minSinceLastBot}m)...`);

                    const { dnaLines } = auditProfile(cand, []); // Custom fields not needed for DNA in rules engine

                    const systemContext = `Eres un reclutador experto y proactivo de Candidatic IA.Tu tarea es analizar si un candidato cumple con una REGLA y actuar de inmediato.
INSTRUCCIONES CRÍTICAS:
- Tu objetivo es mantener viva la conversación y completar el perfil del candidato.
- "ok": true SOLAMENTE si decides enviar un mensaje ahora.
- "msg": El contenido del mensaje de WhatsApp.
- REGLA DE TIEMPO: El tiempo actual es ${now.toISOString()}.
- REGLA DE NOMBRE: Saluda por el[Nombre Real](${cand.nombreReal || cand.nombre || 'No proporcionado'}).
- CONTEXTO:
  * El candidato mandó su último mensaje hace ${minSinceLastUser} minutos.
  * Tú(el bot / reclutador) mandaste el último mensaje hace ${minSinceLastBot} minutos.
- TONO: Natural, como si escribieras rápido en WhatsApp. Cero formalismos excesivos.
- PROHIBIDO EL USO DE ASTERISCOS (*): No los uses para negritas ni para nada. Usa Emojis.
- BREVEDAD: Máximo 2 líneas de texto.
- NO digas que enviarás un mensaje, ESCRIBE el mensaje directamente.`;

                    const evalPrompt = `
REGLA A APLICAR: "${rule.prompt}"
DATOS ACTUALES[DNA DEL CANDIDATO]:
${dnaLines}
- Último mensaje de usuario: ${cand.lastUserMessageAt || 'Nunca'}
- Último mensaje de bot: ${cand.lastBotMessageAt || 'Nunca'}

DECISIÓN:
1. ¿Cumple la regla basada en el contexto temporal y datos del CRM ?
    2. Si la regla menciona "no ha respondido en X tiempo", úsalo.
3. Si la regla menciona "no tiene X dato", busca en "Campos capturados".

Responde ÚNICAMENTE en JSON: { "ok": boolean, "msg": string, "reason": string } `;

                    const res = await model.generateContent([systemContext, evalPrompt]);
                    const out = res.response.text().match(/\{[\s\S]*\}/)?.[0];
                    if (!out) continue;

                    const decision = JSON.parse(out);

                    if (decision.ok && decision.msg) {
                        logs.push(`✨ Match! Enviando mensaje...`);
                        // Limpiar msg de posibles prefijos y remover asteriscos (HARDCODE)
                        let finalMsg = decision.msg.replace(/^Mensaje:\s*/i, '').replace(/^Contenido:\s*/i, '').trim();
                        finalMsg = finalMsg.replace(/\*/g, '');

                        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, finalMsg);
                        await saveMessage(cand.id, {
                            from: 'bot',
                            content: finalMsg,
                            type: 'text',
                            timestamp: new Date().toISOString(),
                            meta: { automationId: rule.id, aiMatch: true }
                        });
                        await redis.set(`ai:automation:last:${cand.id}`, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);
                        await incrementAIAutomationSentCount(rule.id);
                        messagesSent++;
                        logs.push(`🚀 Mensaje enviado exitosamente.`);
                    } else {
                        logs.push(`❌ No cumple criterios.`);
                    }
                } catch (e) {
                    logs.push(`⚠️ Error analizando candidato ${cand.nombre}: ${e.message} `);
                }
            }
        }

        logs.push(`----------------------------------- `);
        logs.push(`🏁 Finalizado: ${evaluatedCount} analizados, ${messagesSent} enviados(Legacy), ${processedCount} enviados(Pipeline).`);
        return { success: true, sent: messagesSent, processedCount, evaluated: evaluatedCount, logs };
    } catch (error) {
        console.error('ENGINE_CRASH:', error);
        logs.push(`🛑 CRASH: ${error.message} `);
        return { success: false, error: error.message, stack: error.stack, logs };
    }
}

/**
 * processNativeProactive
 * Handles the 24/48/72h escalation logic for incomplete profiles.
 */
async function processNativeProactive(redis, model, config, logs, todayKey, now, maxToSend = 1) {
    let sentCount = 0;
    // DYNAMIC IMPORTS
    // const { getCandidates, isProfileComplete, saveMessage } = await import('./storage.js'); // These are now imported at the top

    const { candidates } = await getCandidates(500, 0); // Increase scan depth to 500
    if (!candidates) {
        logs.push(`⚠️[PROACTIVE] No se obtuvieron candidatos de la DB.`);
        return;
    }

    const customFieldsJson = await redis.get('custom_fields');
    const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

    const categoriesData = await redis.get('candidatic_categories');
    const categories = categoriesData ? JSON.parse(categoriesData).map(c => c.name) : [];

    // Filter candidates with incomplete profile based on IRON-CLAD logic
    const incomplete = candidates.filter(c => !isProfileComplete(c, customFields));

    logs.push(`🔍[PROACTIVE] Evaluando ${candidates.length} candidatos totales.${incomplete.length} tienen perfil incompleto.`);

    if (incomplete.length === 0) {
        logs.push(`💤[PROACTIVE] No hay candidatos con perfil incompleto para procesar.`);
        return;
    }

    // Sort by last interaction (oldest first)
    incomplete.sort((a, b) => {
        const tA = new Date(a.lastUserMessageAt || 0).getTime();
        const tB = new Date(b.lastUserMessageAt || 0).getTime();
        return tA - tB;
    });

    const customPrompt = (await redis.get('bot_proactive_prompt')) || (await redis.get('bot_ia_prompt')) || '';

    for (const cand of incomplete) {
        // Nivel 9/10: Salida Automática (Opt-out)
        if (cand.proactive_opt_out) {
            continue;
        }

        const tUser = new Date(cand.lastUserMessageAt || 0).getTime();
        const tBot = new Date(cand.lastBotMessageAt || 0).getTime();
        const lastMsgAt = new Date(Math.max(tUser, tBot));
        const hoursInactive = (now - lastMsgAt) / (1000 * 60 * 60);

        let level = 0;
        if (hoursInactive >= 168) level = 168; // Level 4: 7 Days
        else if (hoursInactive >= 72) level = 72;
        else if (hoursInactive >= 48) level = 48;
        else if (hoursInactive >= 24) level = 24;

        const sessionKey = `proactive:${cand.id}:${level}:${cand.lastUserMessageAt}`;
        const alreadySent = await redis.get(sessionKey);

        if (alreadySent) {
            continue;
        }

        if (level === 0) {
            continue;
        }

        logs.push(`🎯[PROACTIVE] Candidato ${cand.nombre} CALIFICA. Nivel ${level}h (${Math.floor(hoursInactive)}h inactivo).`);

        // Centralized Gold Audit
        const { missingLabels, dnaLines } = auditProfile(cand, customFields);
        const prioritizedMissing = missingLabels.slice(0, 1);

        // Nivel 9/10: Memoria Contextual
        let messageHistory = '';
        try {
            const history = await getMessages(cand.id);
            if (history && history.length > 0) {
                const lastTwo = history.slice(-2);
                messageHistory = lastTwo.map(m => `${m.from === 'bot' ? 'Brenda' : 'Candidato'}: ${m.content}`).join('\n');
            }
        } catch (e) {
            console.warn(`⚠️ Error context memory for ${cand.nombre}:`, e.message);
        }

        const prompt = `
[DNA DEL CANDIDATO]:
${dnaLines}

[MEMORIA DE CONVERSACIÓN RECIENTE]:
${messageHistory || 'No hay mensajes previos.'}

[MISIÓN BRENDA]:
Tu única misión es reactivar la conversación de forma humana, amable y variada. NO pidas datos (nombre, municipio, etc.) en este mensaje. Solo saluda, pregunta cómo está el candidato y muestra interés humano.

[REGLAS DE PERSONALIDAD]:
"${customPrompt || 'Eres la Lic. Brenda Rodríguez de Candidatic IA, un reclutador útil, humano y proactivo.'}"

[REQUISITOS DE ESTILO INVIOLABLES]:
1. BREVEDAD EXTREMA: El mensaje DEBE tener máximo 2 líneas de texto. Prohibido escribir párrafos.
2. SIN PETICIÓN DE DATOS: Prohibido pedir Nombre, Edad, Municipio o Categoría. Solo saludas.
3. PROHIBICIÓN TOTAL DE ASTERISCOS: No uses asteriscos(*) ni guiones(-) en ninguna parte del mensaje.
4. DETECCIÓN DE INTERÉS: Si en la [MEMORIA DE CONVERSACIÓN RECIENTE] el candidato indica que "ya no le interesa", responde ÚNICAMENTE con la palabra "ABORTAR_SEGUIMIENTO".

[ESTRUCTURA DEL MENSAJE]:
- Saludo muy amable y variado (Hola que tal, Holi, Buen día, etc.).
- Pregunta cómo está o cómo ha estado.
- Usa emojis amigables.
- Despedida corta si aplica.

Responde ÚNICAMENTE con el mensaje de texto para WhatsApp (máximo 150 caracteres): `;

        try {
            const startInference = Date.now();
            const res = await model.generateContent(prompt);
            let text = res.response.text().trim();

            // Record Telemetry
            recordAITelemetry({
                model: 'gemini-2.0-flash',
                latency: Date.now() - startInference,
                tokens: res.response?.usageMetadata?.totalTokenCount || 0,
                candidateId: cand.id,
                action: 'proactive_inference'
            });

            // Nivel 9/10: Salida Automática
            if (text.includes('ABORTAR_SEGUIMIENTO')) {
                logs.push(`🛑[PROACTIVE] Candidato ${cand.nombre} ya no está interesado. Abortando y marcando opt-out.`);
                const { updateCandidate } = await import('./storage.js');
                await updateCandidate(cand.id, { proactive_opt_out: true });
                continue;
            }

            // --- 🧪 FINAL ANTI-ASTERISK FILTER ---
            text = text.replace(/\*/g, '');

            if (text) {
                logs.push(`✨[PROACTIVE] Enviando nivel ${level}h a ${cand.nombre}...`);
                await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, text);

                // CRITICAL: Update candidate timestamps to avoid double follow-ups
                const { updateCandidate } = await import('./storage.js');
                await updateCandidate(cand.id, {
                    lastBotMessageAt: new Date().toISOString(),
                    ultimoMensaje: new Date().toISOString()
                });

                await saveMessage(cand.id, {
                    from: 'bot',
                    content: text,
                    type: 'text',
                    timestamp: new Date().toISOString(),
                    meta: { proactiveLevel: level }
                });

                // Mark as sent for this level and this interaction session
                await redis.set(sessionKey, 'sent', 'EX', 7 * 24 * 3600); // 1 week expiration
                await redis.incr(todayKey);
                await redis.incr('ai:proactive:total_sent'); // Track total impact
                await redis.expire(todayKey, 48 * 3600);

                logs.push(`✅[PROACTIVE] Seguimiento enviado con éxito.`);
                sentCount++;
                if (sentCount >= maxToSend) {
                    logs.push(`🏁[PROACTIVE] Se alcanzó el máximo de envíos por este ciclo(${maxToSend}).`);
                    return;
                }
            }
        } catch (e) {
            logs.push(`⚠️[PROACTIVE] Error enviando seguimiento a ${cand.nombre}: ${e.message} `);
            // If it's an API error, maybe don't keep trying 162 candidates to avoid spamming logs
            if (e.message.includes('API') || e.message.includes('model')) {
                logs.push(`🛑[PROACTIVE] Deteniendo ciclo por error crítico de API.`);
                return;
            }
        }
    }
}

/**
 * --- PARTE 3: PIPELINE DE RECLUTAMIENTO ---
 * Procesa los candidatos que están "estacionados" en un paso activo.
 */
async function processProjectPipelines(redis, model, config, logs, manualConfig = null) {
    const { getProjects, getProjectById, getProjectCandidates, getProjectCandidateMetadata, getVacancyById } = await import('./storage.js');

    let projects = [];
    if (manualConfig?.projectId) {
        const p = await getProjectById(manualConfig.projectId);
        if (p) projects = [p];
    } else {
        projects = await getProjects();
    }

    let totalSent = 0;
    logs.push(`🏭[PIPELINE] Escaneando embudos(${projects.length} proyectos)...`);

    for (const proj of projects) {
        if (!proj.steps || proj.steps.length === 0) continue;

        // Find Active Steps
        let activeSteps = proj.steps.filter(s => s.aiConfig?.enabled);

        // If manual, we bypass the "enabled" check for that specific step if needed, 
        // but user usually won't launch a disabled step. 
        // Let's filter by stepId if provided in manualConfig
        if (manualConfig?.stepId) {
            activeSteps = proj.steps.filter(s => s.id === manualConfig.stepId);
        }

        if (activeSteps.length === 0) continue;

        // Load project context (Vacancy)
        let vacancyContext = { name: 'Vacante General', salary: 'Competitivo', schedule: 'Flexible' };
        if (proj.vacancyId) {
            const v = await getVacancyById(proj.vacancyId);
            if (v) vacancyContext = { name: v.name, salary: v.salary_range, description: v.description, schedule: v.schedule };
        }

        // iterate active steps
        for (const step of activeSteps) {
            const stepIndex = proj.steps.findIndex(s => s.id === step.id);
            const nextStep = proj.steps[stepIndex + 1];
            const isNextStepActive = nextStep?.aiConfig?.enabled; // Not strictly needed for wait msg logic, but good context

            // For wait logic: We actually need to know if *current* step has a goal to move to next. 
            // The "Wait Message" logic requested by user is: "If un paso esta apagado... el bot de disculparse en que paso se quedo".
            // This implies we are at Step X (Done) -> Trying to go to Step Y (Off).
            // But usually this logic happens when receiving a message.
            // For PROACTIVE (outbound), the logic is: "I am in Step X. I haven't been contacted yet for Step X."

            // Let's implement the outbound first:
            // "Contact candidates in this step who haven't been processed."

            const candidates = await getProjectCandidates(proj.id);
            logs.push(`🔍[DEBUG] Paso: "${step.name}", Index: ${stepIndex}, ID: ${step.id} `);
            logs.push(`🔍[DEBUG] Candidatos totales en proyecto: ${candidates.length} `);

            const candidatesInStep = candidates.filter(c => {
                const cStepId = c.projectMetadata?.stepId || 'step_new';
                const isFirstStepMatch = (stepIndex === 0 && cStepId === 'step_new');
                const isExactMatch = (cStepId === step.id);
                return isFirstStepMatch || isExactMatch;
            });

            logs.push(`🔍[DEBUG] Candidatos en este paso: ${candidatesInStep.length} `);

            if (candidatesInStep.length === 0) continue;

            for (const cand of candidatesInStep) {
                logs.push(`👤[DEBUG] Evaluando: "${cand.nombre}"(ID: ${cand.id})...`);
                // Check if already processed for this specific step
                const metaKey = `pipeline:${proj.id}:${step.id}:${cand.id}: processed`;
                const isProcessed = await redis.get(metaKey);

                if (isProcessed && !manualConfig) {
                    logs.push(`⏭️[DEBUG] ${cand.nombre} ya fue procesado en este paso anteriormente(Key: ${metaKey}).`);
                    continue;
                }

                if (!cand.whatsapp) {
                    logs.push(`⏭️[DEBUG] ${cand.nombre} no tiene WhatsApp registrado.`);
                    continue;
                }

                // Rate Limit Safety (Global 1 min rule still applies via queue or we break here)
                // For now, let's process 1 per run to be safe alongside Proactive
                // simple semaphore or just rely on the cron frequency

                logs.push(`🎯[PIPELINE] Candidato ${cand.nombre} en paso "${step.name}"(${proj.name}).Iniciando contacto.`);

                // Prepare Prompt
                let promptText = step.aiConfig.prompt || '';

                // Context Injection
                promptText = promptText
                    .replace(/{{Candidato}}/g, cand.nombreReal || cand.nombre || 'Candidato')
                    .replace(/{{Vacante}}/g, vacancyContext.name)
                    .replace(/{{Vacante.Sueldo}}/g, vacancyContext.salary || 'N/A')
                    .replace(/{{Vacante.Horario}}/g, vacancyContext.schedule || 'N/A');

                const systemInstruction = `
[ROL]: Eres Brenda, reclutadora experta de Candidatic.
[OBJETIVO]: Ejecutar la siguiente instrucción paso a paso con el candidato de forma natural pero DISCIPLINADA.
[CONTEXTO DEL PROYECTO]: ${proj.description || ''}
[DATOS VACANTE]: ${JSON.stringify(vacancyContext)}
[INSTRUCCIÓN MAESTRA]: "${promptText}"

REGLAS DE ORO:
1. Sigue ESTRICTAMENTE la[INSTRUCCIÓN MAESTRA].
2. NO menciones sueldos, horarios, ubicación ni detalles de la empresa A MENOS que la[INSTRUCCIÓN MAESTRA] lo pida explícitamente.
3. Si la instrucción es solo preguntar algo, LIMITATE A PREGUNTAR eso.No intentes "vender" la vacante si no es el momento.
4. Tu respuesta debe ser corta(máximo 2 párrafos) y sonar humana.
5. CÓDIGO INTERNO: Si consideras que el candidato ya cumplió el objetivo de este paso, incluye el tag[MOVE] en tu respuesta(esto es para el sistema, NO lo verá el candidato).
`;
                try {
                    const chat = model.startChat({
                        history: [
                            { role: "user", parts: [{ text: "Genera el mensaje para el candidato ahora. No des información de la vacante que no haya solicitado el paso." }] }
                        ]
                    });

                    const result = await chat.sendMessage(systemInstruction);
                    let response = result.response.text();

                    // TRATAMIENTO DE LA RESPUESTA (FILTROS)
                    const moveTagFound = response.match(/\[MOVE\]|\{MOVE\}/gi);
                    const cleanResponse = response.replace(/\[MOVE\]|\{MOVE\}/gi, '').trim();

                    // Send WhatsApp (Clean)
                    await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, cleanResponse);

                    // AUTO-MOVE LOGIC (Outbound)
                    if (moveTagFound) {
                        const { moveCandidateStep } = await import('./storage.js');
                        const currentIndex = proj.steps.findIndex(s => s.id === step.id);
                        const nextStep = proj.steps[currentIndex + 1];
                        if (nextStep) {
                            logs.push(`🚀[PIPELINE] Autómata movió a ${cand.nombre} al siguiente paso: ${nextStep.name} `);
                            await moveCandidateStep(proj.id, cand.id, nextStep.id);
                        }
                    }

                    // CRITICAL: Update candidate timestamps
                    const { updateCandidate } = await import('./storage.js');
                    await updateCandidate(cand.id, {
                        lastBotMessageAt: new Date().toISOString(),
                        ultimoMensaje: new Date().toISOString()
                    });

                    // Mark as processed (Outbound)
                    await redis.set(metaKey, 'true', 'EX', 3600 * 24 * 30); // 30 days expiry

                    logs.push(`✅[PIPELINE] Mensaje enviado a ${cand.nombre}.`);

                    // Log action in history
                    const { saveMessage } = await import('./storage.js');
                    await saveMessage(cand.id, {
                        from: 'bot',
                        content: response,
                        type: 'text',
                        timestamp: new Date().toISOString(),
                        meta: { pipelineStep: step.id, projectId: proj.id }
                    });

                    totalSent++;
                    const limit = manualConfig ? 5 : 1;
                    if (totalSent >= limit) return { sent: totalSent };

                } catch (e) {
                    logs.push(`⚠️[PIPELINE] Error con candidato ${cand.nombre}: ${e.message} `);
                }
            }
        }
    }
    return { sent: totalSent };
}
