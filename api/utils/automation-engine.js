import { getRedisClient, getAIAutomations, getCandidates, saveMessage, getCandidateByPhone } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;
const BATCH_SIZE = 25;

/**
 * runAIAutomations
 * Zuckerberg Edition: Optimized to NEVER timeout.
 */
export async function runAIAutomations(isManual = false) {
    const logs = [];
    let evaluatedCount = 0;
    let messagesSent = 0;

    // Safety check for keys
    if (!process.env.GEMINI_API_KEY) {
        return { success: false, error: 'Falta GEMINI_API_KEY', logs: ['❌ Error: Falta configuración de IA.'] };
    }

    try {
        const automations = await getAIAutomations();
        const activeRules = automations.filter(a => a.active);

        if (activeRules.length === 0) {
            return { success: true, message: 'No rules', evaluated: 0, sent: 0, logs: ['No hay reglas activas.'] };
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
            logs.push(`🔍 Analizando: "${rule.name}"`);

            // Phase 1: FAST Search Intent Extraction
            let entities = { phone: null, name: null };
            try {
                const extractionResult = await model.generateContent(`Extract search terms from this rule: "${rule.prompt}". Return JSON ONLY: { "phone": string|null, "name": string|null }`);
                const jsonText = extractionResult.response.text().match(/\{[\s\S]*\}/)?.[0];
                if (jsonText) entities = JSON.parse(jsonText);
            } catch (e) { console.error('Extraction Error:', e); }

            // Phase 2: Sniper selection
            let candidatesToProcess = [];
            if (entities.phone) {
                const cleanPhone = entities.phone.replace(/\D/g, '');
                logs.push(`🎯 Buscando número: ${cleanPhone}`);
                const c = await getCandidateByPhone(cleanPhone);
                if (c) {
                    candidatesToProcess = [c];
                    logs.push(`✅ Encontrado: ${c.nombre}`);
                }
            } else if (entities.name) {
                const { candidates } = await getCandidates(20, 0, entities.name);
                candidatesToProcess = candidates;
            } else {
                // Limit broad scan in manual mode to prevent time-out
                const { candidates } = await getCandidates(isManual ? 50 : 200, 0);
                candidatesToProcess = candidates;
            }

            if (candidatesToProcess.length === 0) {
                logs.push(`⚠️ No se hallaron candidatos.`);
                continue;
            }

            // Phase 3: Evaluate and send
            const redis = getRedisClient();
            for (let i = 0; i < candidatesToProcess.length; i += BATCH_SIZE) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                const batch = candidatesToProcess.slice(i, i + BATCH_SIZE);
                evaluatedCount += batch.length;

                const context = batch.map(c => ({ id: c.id, nombre: c.nombre, phone: c.whatsapp }));
                const finalPrompt = `Rule: "${rule.prompt}". Candidates: ${JSON.stringify(context)}. Return JSON: { "matches": [ { "id": "...", "message": "..." } ] }`;

                try {
                    const result = await model.generateContent(finalPrompt);
                    const cleanJson = result.response.text().match(/\{[\s\S]*\}/)?.[0];
                    if (!cleanJson) continue;

                    const { matches = [] } = JSON.parse(cleanJson);
                    for (const match of matches) {
                        if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
                        const cand = batch.find(c => c.id === match.id);
                        if (!cand) continue;

                        const config = await getUltraMsgConfig();
                        if (config) {
                            await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, match.message);
                            await saveMessage(cand.id, {
                                from: 'bot', content: match.message, type: 'text', timestamp: new Date().toISOString(),
                                meta: { automationId: rule.id }
                            });
                            await redis.set(`ai:automation:last:${cand.id}`, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);
                            messagesSent++;
                            logs.push(`✨ Enviado a ${cand.nombre}: "${match.message}"`);
                        }
                    }
                } catch (e) {
                    logs.push(`❌ Error evaluando lote.`);
                }
            }
        }

        return { success: true, evaluated: evaluatedCount, sent: messagesSent, logs };
    } catch (error) {
        return { success: false, error: error.message, logs: [`❌ Fatal: ${error.message}`] };
    }
}
