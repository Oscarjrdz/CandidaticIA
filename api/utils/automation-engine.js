import { getRedisClient, getAIAutomations, getCandidates, saveMessage, getCandidateByPhone } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;

export async function runAIAutomations(isManual = false) {
    const logs = [];
    let messagesSent = 0;
    let evaluatedCount = 0;

    try {
        console.log(`🚀 [ENGINE] Starting (Manual: ${isManual})`);

        // --- 1. PRE-FLIGHT CHECKS ---
        if (!process.env.GEMINI_API_KEY) {
            return { success: false, error: 'GEMINI_API_KEY no configurada', logs: ['❌ Error: Falta API Key de Google Gemini.'] };
        }

        const config = await getUltraMsgConfig();
        if (!config || !config.instanceId || !config.token) {
            return { success: false, error: 'UltraMsg no configurado', logs: ['❌ Error: Configura primero UltraMsg en el panel principal.'] };
        }

        const automations = await getAIAutomations();
        const activeRules = (automations || []).filter(a => a && a.active && a.prompt);

        if (activeRules.length === 0) {
            return { success: true, message: 'No active rules', evaluated: 0, sent: 0, logs: ['No hay reglas activas que procesar.'] };
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
            logs.push(`🔍 Analizando regla: "${rule.name || 'Sin nombre'}"`);

            // --- 2. FAST-PATH SNIPER (Detect phone in prompt without LLM if possible) ---
            let targetPhone = null;
            const phoneMatch = rule.prompt.match(/(\d{10,15})/);
            if (phoneMatch) {
                targetPhone = phoneMatch[0];
                logs.push(`🎯 Sniper Automático detectado: ${targetPhone}`);
            }

            // --- 3. INTELLIGENT SEARCH (If no fast-path phone) ---
            let candidates = [];
            if (targetPhone) {
                const c = await getCandidateByPhone(targetPhone);
                if (c) candidates = [c];
                else logs.push(`⚠️ No se encontró el número ${targetPhone} en la base.`);
            } else {
                // LLM extraction for intent
                try {
                    const extra = await model.generateContent(`Extract specific phone or name from: "${rule.prompt}". JSON ONLY: {"p":null,"n":null}`);
                    const json = JSON.parse(extra.response.text().match(/\{[\s\S]*\}/)?.[0] || '{}');
                    if (json.p) {
                        const c = await getCandidateByPhone(json.p);
                        if (c) candidates = [c];
                    } else if (json.n) {
                        const { candidates: res } = await getCandidates(20, 0, json.n);
                        candidates = res;
                    } else {
                        // Scan recent
                        const { candidates: res } = await getCandidates(isManual ? 50 : 200, 0);
                        candidates = res;
                    }
                } catch (e) {
                    const { candidates: res } = await getCandidates(20, 0);
                    candidates = res;
                }
            }

            if (!candidates || candidates.length === 0) continue;

            // --- 4. FINAL EVALUATION & SENDING ---
            const redis = getRedisClient();
            for (const cand of candidates) {
                if (!cand || !cand.id || !cand.whatsapp) continue;
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                // Cooldown check for CRON
                if (!isManual) {
                    const cooldown = await redis.get(`ai:automation:last:${cand.id}`);
                    if (cooldown) continue;
                }

                evaluatedCount++;
                try {
                    const evalPrompt = `Rule: "${rule.prompt}". Candidate: ${cand.nombre} (${cand.whatsapp}). Match? If yes, write msg. JSON: {"m":boolean,"txt":string}`;
                    const res = await model.generateContent(evalPrompt);
                    const decision = JSON.parse(res.response.text().match(/\{[\s\S]*\}/)?.[0] || '{"m":false}');

                    if (decision.m && decision.txt) {
                        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, decision.txt);
                        await saveMessage(cand.id, {
                            from: 'bot', content: decision.txt, type: 'text', timestamp: new Date().toISOString(),
                            meta: { automationId: rule.id }
                        });
                        await redis.set(`ai:automation:last:${cand.id}`, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);
                        messagesSent++;
                        logs.push(`✅ Enviado a ${cand.nombre}: "${decision.txt}"`);
                    }
                } catch (e) {
                    console.error('Eval Error:', e);
                }
            }
        }

        return { success: true, evaluated: evaluatedCount, sent: messagesSent, logs };
    } catch (error) {
        console.error('CRITICAL ENGINE ERROR:', error);
        return { success: false, error: error.message, logs: [`❌ Fatal: ${error.message}`] };
    }
}
