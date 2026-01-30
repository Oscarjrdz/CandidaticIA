import { getRedisClient, getAIAutomations, getCandidates, saveMessage, getCandidateByPhone, incrementAIAutomationSentCount } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;

/**
 * runAIAutomations
 * Zuckerberg Trace Edition: Captures every step and error.
 */
export async function runAIAutomations(isManual = false) {
    const logs = [];
    let messagesSent = 0;
    let evaluatedCount = 0;

    try {
        logs.push(`🚀 [SYSTEM] Iniciando motor (Manual: ${isManual})`);

        // --- 1. CONFIG AUDIT ---
        let geminiKey = process.env.GEMINI_API_KEY;
        const redis = getRedisClient();

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
            logs.push(`❌ CRITICAL: UltraMsg no está vinculado (Falta Instance ID o Token).`);
            return { success: false, error: 'ULTRAMSG_CONFIG_MISSING', logs };
        }
        logs.push(`✅ Configuración y API Key verificadas.`);

        const automations = await getAIAutomations();
        const activeRules = (automations || []).filter(a => a?.active && a?.prompt);

        if (activeRules.length === 0) {
            logs.push(`ℹ️ No se encontraron reglas activas para procesar.`);
            return { success: true, logs };
        }
        logs.push(`📋 Procesando ${activeRules.length} reglas activas.`);

        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // --- NATIVE PROACTIVE FOLLOW-UP LOGIC ---
        const isProactiveEnabled = (await redis.get('bot_proactive_enabled')) === 'true';
        if (isProactiveEnabled) {
            logs.push(`🔍 [PROACTIVE] Iniciando análisis de seguimiento...`);

            // Check Time Window (7 AM - 11 PM) - Force UTC-6 (Mexico)
            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const mxTime = new Date(utc + (3600000 * -6));
            const nowHour = mxTime.getHours();

            if (nowHour < 7 || nowHour >= 23) {
                logs.push(`💤 [PROACTIVE] Fuera de horario permitido (7:00 - 23:00). Hora MX actual: ${nowHour}:00`);
            } else {
                // Check Daily Limit
                const todayKey = `ai:proactive:count:${new Date().toISOString().split('T')[0]}`;
                const dailyCount = parseInt(await redis.get(todayKey) || '0');
                if (dailyCount >= 100) {
                    logs.push(`🛑 [PROACTIVE] Límite diario alcanzado (100/día).`);
                } else {
                    await processNativeProactive(redis, model, config, logs, todayKey);
                }
            }
        }

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
            logs.push(`-----------------------------------`);
            logs.push(`⚙️ Regla: "${rule.name || 'Sin nombre'}"`);

            // --- 2. SNIPER DETECTION ---
            let targetPhone = null;
            const phoneMatch = rule.prompt.match(/(\d{10,13})/);
            if (phoneMatch) {
                targetPhone = phoneMatch[0];
                logs.push(`🎯 Sniper detectado: ${targetPhone}`);
            }

            let candidates = [];
            if (targetPhone) {
                const c = await getCandidateByPhone(targetPhone);
                if (c) {
                    candidates = [c];
                    logs.push(`✅ Candidato identificado: ${c.nombre}`);
                } else {
                    logs.push(`⚠️ El número ${targetPhone} no existe en la base de datos.`);
                }
            } else {
                logs.push(`🧠 IA: Escaneando intención compleja...`);
                try {
                    const extra = await model.generateContent(`Extract phone/name from: "${rule.prompt}". JSON ONLY: {"p":null,"n":null}`);
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
            const redis = getRedisClient();
            for (const cand of candidates) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
                if (!cand?.id || !cand?.whatsapp) continue;

                if (!isManual) {
                    const last = await redis.get(`ai:automation:last:${cand.id}`);
                    if (last) continue;
                }

                const now = new Date();
                const lastUserMsg = cand.lastUserMessageAt ? new Date(cand.lastUserMessageAt) : null;
                const lastBotMsg = cand.lastBotMessageAt ? new Date(cand.lastBotMessageAt) : null;

                // Calculate inactivity in minutes
                const minSinceLastUser = lastUserMsg ? Math.floor((now - lastUserMsg) / 60000) : 999;
                const minSinceLastBot = lastBotMsg ? Math.floor((now - lastBotMsg) / 60000) : 999;

                evaluatedCount++;
                try {
                    logs.push(`🤔 Evaluando a ${cand.nombre} (Inactividad Usuario: ${minSinceLastUser}m, Bot: ${minSinceLastBot}m)...`);

                    const systemContext = `Eres un reclutador experto y proactivo de Candidatic IA. Tu tarea es analizar si un candidato cumple con una REGLA y actuar de inmediato.
INSTRUCCIONES CRÍTICAS:
- Tu objetivo es mantener viva la conversación y completar el perfil del candidato.
- "ok": true SOLAMENTE si decides enviar un mensaje ahora.
- "msg": El contenido del mensaje de WhatsApp.
- REGLA DE TIEMPO: El tiempo actual es ${now.toISOString()}. 
- REGLA DE NOMBRE: Saluda por el [Nombre Real] (${cand.nombreReal || cand.nombre || 'No proporcionado'}).
- CONTEXTO:
  * El candidato mandó su último mensaje hace ${minSinceLastUser} minutos.
  * Tú (el bot/reclutador) mandaste el último mensaje hace ${minSinceLastBot} minutos.
- TONO: Natural, como si escribieras rápido en WhatsApp. Cero formalismos excesivos.
- NO digas que enviarás un mensaje, ESCRIBE el mensaje directamente.`;

                    const evalPrompt = `
REGLA A APLICAR: "${rule.prompt}"
DATOS ACTUALES DEL CANDIDATO:
- Nombre: ${cand.nombreReal || cand.nombre || 'No proporcionado'}
- WhatsApp: ${cand.whatsapp}
- Status: ${cand.status}
- Campos capturados (CRM): ${JSON.stringify(cand.campos || {})}
- Último mensaje de usuario: ${cand.lastUserMessageAt || 'Nunca'}
- Último mensaje de bot: ${cand.lastBotMessageAt || 'Nunca'}

DECISIÓN:
1. ¿Cumple la regla basada en el contexto temporal y datos del CRM?
2. Si la regla menciona "no ha respondido en X tiempo", úsalo.
3. Si la regla menciona "no tiene X dato", busca en "Campos capturados".

Responde ÚNICAMENTE en JSON: {"ok": boolean, "msg": string, "reason": string}`;

                    const res = await model.generateContent([systemContext, evalPrompt]);
                    const out = res.response.text().match(/\{[\s\S]*\}/)?.[0];
                    if (!out) continue;

                    const decision = JSON.parse(out);

                    if (decision.ok && decision.msg) {
                        logs.push(`✨ Match! Enviando mensaje...`);
                        // Limpiar msg de posibles prefijos que la IA ponga por error
                        let finalMsg = decision.msg.replace(/^Mensaje:\s*/i, '').replace(/^Contenido:\s*/i, '').trim();

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
                    logs.push(`⚠️ Error analizando candidato ${cand.nombre}: ${e.message}`);
                }
            }
        }

        logs.push(`-----------------------------------`);
        logs.push(`🏁 Finalizado: ${evaluatedCount} analizados, ${messagesSent} enviados.`);
        return { success: true, sent: messagesSent, evaluated: evaluatedCount, logs };
    } catch (error) {
        console.error('ENGINE_CRASH:', error);
        logs.push(`🛑 CRASH: ${error.message}`);
        return { success: false, error: error.message, stack: error.stack, logs };
    }
}

/**
 * processNativeProactive
 * Handles the 24/48/72h escalation logic for incomplete profiles.
 */
async function processNativeProactive(redis, model, config, logs, todayKey) {
    const { candidates } = await getCandidates(500, 0); // Increase scan depth to 500
    if (!candidates) return;

    // Filter candidates with incomplete step 1 status
    // We assume 'paso1Status' or similar field. Let's look for missing core data.
    const incomplete = candidates.filter(c => {
        const isComp = c.nombreReal && c.municipio; // Logic from ADNSection.jsx
        return !isComp;
    });

    if (incomplete.length === 0) return;

    // Sort by last interaction (oldest first)
    incomplete.sort((a, b) => {
        const tA = new Date(a.lastUserMessageAt || 0).getTime();
        const tB = new Date(b.lastUserMessageAt || 0).getTime();
        return tA - tB;
    });

    const now = new Date();

    for (const cand of incomplete) {
        const lastMsgAt = new Date(cand.lastUserMessageAt || cand.lastBotMessageAt || 0);
        const hoursInactive = (now - lastMsgAt) / (1000 * 60 * 60);

        let level = 0;
        if (hoursInactive >= 72) level = 72;
        else if (hoursInactive >= 48) level = 48;
        else if (hoursInactive >= 24) level = 24;

        if (level === 0) continue;

        // Check if we already sent this level for this session of inactivity
        // We use a flag linked to the lastUserMessageAt timestamp to know it's a "new" silence
        const sessionKey = `proactive:${cand.id}:${level}:${cand.lastUserMessageAt}`;
        const alreadySent = await redis.get(sessionKey);
        if (alreadySent) continue;

        logs.push(`🎯 [PROACTIVE] Candidato ${cand.nombre} califica para nivel ${level}h (${Math.floor(hoursInactive)}h inactivo).`);

        const prompt = `
Eres el asistente de Candidatic IA. El candidato ${cand.nombreReal || cand.nombre} tiene su perfil INCOMPLETO.
Le falta: ${!cand.nombreReal ? 'Nombre Real' : ''} ${!cand.municipio ? 'Municipio' : ''}.
Han pasado ${level} horas desde su último mensaje.
TU MISIÓN: Escribir un mensaje de WhatsApp para el Nivel ${level}h de seguimiento.

NIVELES:
- 24h: Recordatorio amable y servicial.
- 48h: Recordatorio más directo, preguntando si sigue interesado.
- 72h: Mensaje de cierre, indicando que el expediente se pondrá en pausa.

REGLAS:
- No uses formalismos aburridos.
- Sé natural, breve y humano.
- Usa su nombre: ${cand.nombreReal || cand.nombre}.
- NO pongas prefijos tipo "Mensaje:". Escribe solo el texto del mensaje.
`;

        try {
            const res = await model.generateContent(prompt);
            const text = res.response.text().trim();

            if (text) {
                logs.push(`✨ [PROACTIVE] Enviando nivel ${level}h a ${cand.nombre}...`);
                await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, text);
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
                await redis.expire(todayKey, 48 * 3600);

                logs.push(`✅ [PROACTIVE] Seguimiento enviado con éxito.`);
                return; // SEND ONLY ONE PER RUN (Rate Limit 1/min)
            }
        } catch (e) {
            logs.push(`⚠️ [PROACTIVE] Error enviando seguimiento: ${e.message}`);
        }
    }
}
