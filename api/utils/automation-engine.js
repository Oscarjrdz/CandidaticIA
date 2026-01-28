import { getRedisClient, getAIAutomations, getCandidates, saveMessage, getCandidateByPhone } from './storage.js';
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
