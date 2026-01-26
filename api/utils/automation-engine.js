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
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) {
            logs.push(`❌ CRITICAL: Falta GEMINI_API_KEY en variables de entorno.`);
            return { success: false, error: 'GEMINI_API_KEY_MISSING', logs };
        }

        const config = await getUltraMsgConfig();
        if (!config?.instanceId || !config?.token) {
            logs.push(`❌ CRITICAL: UltraMsg no está vinculado (Falta Instance ID o Token).`);
            return { success: false, error: 'ULTRAMSG_CONFIG_MISSING', logs };
        }
        logs.push(`✅ Configuración verificada.`);

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

                evaluatedCount++;
                try {
                    logs.push(`🤔 Evaluando a ${cand.nombre}...`);
                    const res = await model.generateContent(`Regla: "${rule.prompt}". Candidato: ${cand.nombre}. Status: ${cand.status}. Bio: ${JSON.stringify(cand.campos || {})}. ¿Cumple? JSON: {"ok":bool,"msg":string}`);
                    const out = res.response.text().match(/\{[\s\S]*\}/)?.[0];
                    if (!out) continue;

                    const decision = JSON.parse(out);

                    if (decision.ok && decision.msg) {
                        logs.push(`✨ Match! Enviando mensaje...`);
                        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, decision.msg);
                        await saveMessage(cand.id, {
                            from: 'bot',
                            content: decision.msg,
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
