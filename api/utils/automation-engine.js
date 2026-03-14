import {
    getRedisClient,
    getMessages,
    getCandidates,
    saveMessage,
    getCandidateByPhone,
    updateCandidate,
    auditProfile,
    recordAITelemetry
} from './storage.js';
import { getOpenAIResponse } from './openai.js';
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

        let openAiKey = process.env.OPENAI_API_KEY;

        if (!openAiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                openAiKey = aiConfig.openaiApiKey;
            }
        }

        if (!openAiKey || openAiKey === 'undefined' || openAiKey === 'null') {
            logs.push(`❌ CRITICAL: Falta OPENAI_API_KEY. Configure su API Key en Ajustes.`);
            return { success: false, error: 'OPENAI_API_KEY_MISSING', logs };
        }

        const config = await getUltraMsgConfig();
        if (!config?.instanceId || !config?.token) {
            logs.push(`❌ CRITICAL: UltraMsg no está vinculado(Falta Instance ID o Token).`);
            return { success: false, error: 'ULTRAMSG_CONFIG_MISSING', logs };
        }
        logs.push(`✅ Configuración y API Key verificadas.`);

        // --- PIPELINE DE RECLUTAMIENTO ---
        try {
            const pipeResult = await processProjectPipelines(redis, openAiKey, config, logs, manualConfig);
            processedCount = pipeResult?.sent || 0;
        } catch (e) {
            logs.push(`⚠️[PIPELINE] Error procesando embudos: ${e.message} `);
        }

        logs.push(`----------------------------------- `);
        logs.push(`🏁 Finalizado: ${processedCount} enviados(Pipeline).`);
        return { success: true, sent: 0, processedCount, evaluated: 0, logs };
    } catch (error) {
        console.error('ENGINE_CRASH:', error);
        logs.push(`🛑 CRASH: ${error.message} `);
        return { success: false, error: error.message, stack: error.stack, logs };
    }
}

/**
 * --- PARTE 3: PIPELINE DE RECLUTAMIENTO ---
 * Procesa los candidatos que están "estacionados" en un paso activo.
 */
async function processProjectPipelines(redis, openAiKey, config, logs, manualConfig = null) {
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

        let vacancyContext = {
            name: '',
            salary: '',
            schedule: '',
            description: '',
            messageDescription: ''
        };

        const activeVacancyId = Array.isArray(proj.vacancyIds) && proj.vacancyIds.length > 0 ? proj.vacancyIds[0] : proj.vacancyId;

        if (activeVacancyId) {
            const v = await getVacancyById(activeVacancyId);
            if (v) vacancyContext = {
                name: v.name || '',
                salary: v.salary_range || '',
                description: v.description || '',
                messageDescription: v.messageDescription || v.description || '',
                schedule: v.schedule || ''
            };
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
                let match = false;
                let reason = '';
                // 🚀 BLAZING FAST HANDOVER BYPASS: Target exact candidate immediately
                if (manualConfig?.targetCandidateId) {
                    if (c.id === manualConfig.targetCandidateId) {
                        match = true;
                        reason = 'Manual Target Match';
                    } else {
                        reason = 'Not the target';
                    }
                } else {
                    const cStepId = c.projectMetadata?.stepId || 'step_new';
                    const isFirstStepMatch = (stepIndex === 0 && cStepId === 'step_new');
                    const isExactMatch = (cStepId === step.id);
                    match = isFirstStepMatch || isExactMatch;
                    reason = match ? 'Natural Match' : 'Step ID mismatch';
                }

                if (manualConfig?.targetCandidateId) {
                    try {
                        require('fs').appendFileSync('/tmp/auto_debug.log', `[${new Date().toISOString()}] Target: ${manualConfig.targetCandidateId} | Checking ${c.id} (${c.nombre}) | Match: ${match} - ${reason} | Status: ${c.status}\n`);
                    } catch (e) { }
                }
                return match;
            });

            logs.push(`🔍[DEBUG] Candidatos en este paso: ${candidatesInStep.length} `);

            if (candidatesInStep.length === 0) continue;

            for (const cand of candidatesInStep) {
                logs.push(`👤[DEBUG] Evaluando: "${cand.nombre}"(ID: ${cand.id})...`);

                // 🛡️ [BLOCK SHIELD]: Force skipping for blocked candidates
                if (cand.blocked === true) {
                    logs.push(`⏭️[BLOCK SHIELD] Skipping blocked candidate: ${cand.nombre}`);
                    continue;
                }
                // Check if already processed for this specific step
                const metaKey = `pipeline:${proj.id}:${step.id}:${cand.id}:processed`;
                const isProcessed = await redis.get(metaKey);

                if (isProcessed) {
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

                // Context Injection (Case Insensitive)
                promptText = promptText
                    .replace(/{{Candidato}}/gi, (cand.nombreReal || cand.nombre || 'Candidato').split(' ')[0])
                    .replace(/{{Vacante}}/gi, vacancyContext.name)
                    .replace(/{{Vacante\.MessageDescription}}/gi, vacancyContext.messageDescription || vacancyContext.description || '')
                    .replace(/{{Vacante\.Descripcion}}/gi, vacancyContext.description || '')
                    .replace(/{{Vacante\.Sueldo}}/gi, vacancyContext.salary || 'N/A')
                    .replace(/{{Vacante\.Horario}}/gi, vacancyContext.schedule || 'N/A');

                const systemInstructionText = `
[ROL]: Eres Brenda, reclutadora experta de Candidatic.
[OBJETIVO]: Ejecutar la siguiente instrucción paso a paso con el candidato de forma natural pero DISCIPLINADA.
[CONTEXTO DEL PROYECTO]: ${proj.description || ''}
[DATOS REALES DE LA VACANTE]: ${JSON.stringify(vacancyContext)}
[INSTRUCCIÓN MAESTRA]: "${promptText}"

REGLAS DE ORO:
1. Sigue ESTRICTAMENTE la [INSTRUCCIÓN MAESTRA].
2. NO INVENTES detalles de la vacante (Sueldo, Ubicación, Empresa) si no están en los [DATOS REALES DE LA VACANTE] o en la [INSTRUCCIÓN MAESTRA].
3. Si la [INSTRUCCIÓN MAESTRA] contiene un [ERROR: ...], no lo menciones directamente al candidato. En su lugar, dile amablemente que estás validando los detalles del puesto y que en un momento se los compartes.
4. Si la instrucción es solo preguntar algo, LIMITATE A PREGUNTAR eso. No intentes "vender" la vacante si no es el momento.
5. Tu respuesta debe ser natural, sonar humana y respetar la brevedad/longitud configurada en tu instrucción.
6. CÓDIGO INTERNO: Si consideras que el candidato ya cumplió el objetivo de este paso (ej. aceptó la entrevista), incluye el tag [MOVE] en tu respuesta.
7. OBLIGACIÓN DE CIERRE (MANDATORIO): Si la instrucción maestra incluye invitar a entrevista o mandar fechas, SIEMPRE termina tu mensaje textualmente con la pregunta "¿Te gustaría agendar una entrevista?" o "¿Te queda bien?". NUNCA termines con frases abiertas como "Si tienes dudas avísame".
8. NOMBRE: SIEMPRE dirige al candidato por su PRIMER NOMBRE únicamente. NUNCA uses nombre completo ni apellidos cuando lo saludes o menciones.
`;
                try {
                    const messageHistory = [
                        { role: 'system', content: systemInstructionText },
                        { role: 'user', content: "Hola Brenda, ya terminé mi perfil. ¿Qué sigue?" }
                    ];

                    const result = await getOpenAIResponse(messageHistory, "Genera el mensaje para el candidato ahora basado en tu instrucción maestra.", "gpt-4o-mini");
                    let response = result?.content || "";

                    // TRATAMIENTO DE LA RESPUESTA (FILTROS)
                    const moveTagFound = response.match(/\[MOVE\]|\{MOVE\}/gi);
                    const cleanResponse = response.replace(/\[MOVE\]|\{MOVE\}/gi, '').trim();

                    // Send WhatsApp (Clean with Splitting)
                    const splitRegex = /(¿Te gustaría agendar.*?entrevista.*?\?|¿Te queda bien\??)/i;
                    let messagesToSend = [cleanResponse];
                    const ctaFirstName = (cand.nombreReal || cand.nombre || '').split(' ')[0];

                    if (splitRegex.test(cleanResponse)) {
                        const parts = cleanResponse.split(splitRegex);
                        if (parts.length >= 3) {
                            let ctaMsg = (parts[1] + (parts[2] || '')).trim();
                            // Inject first name before the closing ? in the CTA bubble
                            // "¿Te gustaría agendar...? 😊" → "¿Te gustaría agendar... Oscar? 😊"
                            if (ctaFirstName) {
                                ctaMsg = ctaMsg.replace(/(\?)([\s\p{Emoji}\s]*)$/u, (_, q, trail) => ` ${ctaFirstName}${q}${trail || ''}`);
                            }
                            messagesToSend = [
                                parts[0].trim(),
                                ctaMsg
                            ].filter(Boolean);
                        }
                    }

                    for (let i = 0; i < messagesToSend.length; i++) {
                        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, messagesToSend[i], 'chat', { priority: i });
                        if (messagesToSend.length > 1 && i < messagesToSend.length - 1) {
                            await new Promise(r => setTimeout(r, 3000));
                        }
                    }

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

                    // 🛡️ FAILSAFE: Si OpenAI falla o hay error de parsing, garantizamos la vacante
                    try {
                        console.warn(`[AUTOMATION-ENGINE] ⚠️ Failsafe auto-trigger firing for ${cand.nombre}! Error:`, e.message);
                        let candidateFirstName = (cand.nombreReal || cand.nombre || 'Candidato').split(' ')[0];
                        let p = `¡Mira ${candidateFirstName}! Te comparto la vacante que encontré para ti: ⏬\n\n${vacancyContext.messageDescription || vacancyContext.description || ''}`;

                        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, p, 'chat', { priority: 0 });

                        const { updateCandidate, saveMessage } = await import('./storage.js');
                        await updateCandidate(cand.id, {
                            lastBotMessageAt: new Date().toISOString(),
                            ultimoMensaje: new Date().toISOString()
                        });

                        await redis.set(metaKey, 'true', 'EX', 3600 * 24 * 30);

                        await saveMessage(cand.id, {
                            from: 'bot',
                            content: p,
                            type: 'text',
                            timestamp: new Date().toISOString(),
                            meta: { pipelineStep: step.id, projectId: proj.id, failsafe: true }
                        });

                        totalSent++;
                        const limit = manualConfig ? 5 : 1;
                        if (totalSent >= limit) return { sent: totalSent, logs };
                    } catch (failsafeErr) {
                        logs.push(`❌[PIPELINE FAILSAFE ENGINE] Catastrophic failure for ${cand.nombre}: ${failsafeErr.message}`);
                    }
                }
            }
        }
    }
    return { sent: totalSent };
}
