import { getRedisClient, getAIAutomations, getCandidates, saveMessage, getCandidateByPhone } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;

/**
 * runAIAutomations
 * Hybrid Sniper Engine: Fast-path for numbers, LLM for intent.
 */
export async function runAIAutomations(isManual = false) {
    const logs = [];
    let messagesSent = 0;
    let evaluatedCount = 0;

    try {
        console.log(`🚀 [AI_ENGINE] Start (Mode: ${isManual ? 'Manual' : 'Cron'})`);

        // --- 1. CONFIG CHECKS ---
        if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY_MISSING');
        const config = await getUltraMsgConfig();
        if (!config?.instanceId || !config?.token) throw new Error('ULTRAMSG_CONFIG_MISSING');

        const automations = await getAIAutomations();
        const activeRules = (automations || []).filter(a => a?.active && a?.prompt);

        if (activeRules.length === 0) {
            return { success: true, logs: ['No hay reglas activas.'] };
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
            logs.push(`🔍 Motor: ${rule.name || 'Análisis'}`);

            // --- 2. HYBRID SNIPER PATH ---
            let targetPhone = null;
            const phoneMatch = rule.prompt.match(/(\d{10,13})/);
            if (phoneMatch) {
                targetPhone = phoneMatch[0];
                logs.push(`⚡ Fast-Path: Número detectado (${targetPhone})`);
            }

            let candidates = [];
            if (targetPhone) {
                const c = await getCandidateByPhone(targetPhone);
                if (c) candidates = [c];
                else logs.push(`⚠️ No se encontró al candidato con el número ${targetPhone}`);
            } else {
                // LLM Fallback (Slow path)
                logs.push(`🧠 IA: Escaneando intención...`);
                try {
                    const extra = await model.generateContent(`Extaer teléfono o nombre de: "${rule.prompt}". Responder JSON ÚNICAMENTE: {"p":null,"n":null}`);
                    const json = JSON.parse(extra.response.text().match(/\{[\s\S]*\}/)?.[0] || '{}');
                    if (json.p) {
                        const c = await getCandidateByPhone(json.p);
                        if (c) candidates = [c];
                    } else {
                        const { candidates: list } = await getCandidates(isManual ? 30 : 100, 0, json.n || '');
                        candidates = list;
                    }
                } catch (e) {
                    const { candidates: list } = await getCandidates(20, 0);
                    candidates = list;
                }
            }

            if (!candidates || candidates.length === 0) continue;

            const redis = getRedisClient();
            for (const cand of candidates) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
                if (!cand?.id || !cand?.whatsapp) continue;

                // Cooldown check
                if (!isManual) {
                    const last = await redis.get(`ai:automation:last:${cand.id}`);
                    if (last) continue;
                }

                evaluatedCount++;
                try {
                    const res = await model.generateContent(`Regla: "${rule.prompt}". Candidato: ${cand.nombre}. ¿Cumple? Si si, escribe mensaje WA. JSON: {"ok":bool,"msg":string}`);
                    const decision = JSON.parse(res.response.text().match(/\{[\s\S]*\}/)?.[0] || '{"ok":false}');

                    if (decision.ok && decision.msg) {
                        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, decision.msg);
                        await saveMessage(cand.id, {
                            from: 'bot', content: decision.msg, type: 'text', timestamp: new Date().toISOString(),
                            meta: { automationId: rule.id }
                        });
                        await redis.set(`ai:automation:last:${cand.id}`, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);
                        messagesSent++;
                        logs.push(`✅ Mensaje enviado a ${cand.nombre}`);
                    }
                } catch (e) { console.error('Eval failed', e); }
            }
        }

        return { success: true, sent: messagesSent, evaluated: evaluatedCount, logs };
    } catch (error) {
        console.error('ENGINE_FATAL:', error);
        return { success: false, error: error.message, logs: [`❌ Error: ${error.message}`] };
    }
}
