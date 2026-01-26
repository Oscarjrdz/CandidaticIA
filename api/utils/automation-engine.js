import { getRedisClient, getAIAutomations, getCandidates, saveMessage } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;
const BATCH_SIZE = 25;

export async function runAIAutomations(bypassCooldown = false) {
    const logs = [];
    let evaluated = 0;
    let messagesSent = 0;

    try {
        const automations = await getAIAutomations();
        const activeRules = automations.filter(a => a.active);

        if (activeRules.length === 0) {
            return { success: true, message: 'No active AI automations', evaluated, sent: 0, logs: [] };
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // Get Candidates (Analyzing 2000 for wider reach)
        const { candidates } = await getCandidates(2000, 0);
        const redis = getRedisClient();

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

            logs.push(`🔍 Procesando regla: "${rule.name}"`);

            // Filter out candidates on cooldown (if not bypassing)
            let eligibleCandidates = candidates;
            if (!bypassCooldown) {
                const cooldownResults = await Promise.all(
                    candidates.map(async c => {
                        const hasCooldown = await redis.get(`ai:automation:last:${c.id}`);
                        return { c, hasCooldown };
                    })
                );
                eligibleCandidates = cooldownResults.filter(r => !r.hasCooldown).map(r => r.c);
            }

            // Batch Process
            for (let i = 0; i < eligibleCandidates.length; i += BATCH_SIZE) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                const batch = eligibleCandidates.slice(i, i + BATCH_SIZE);
                evaluated += batch.length;

                const contextBatch = batch.map(c => ({
                    id: c.id,
                    name: c.nombre,
                    phone: c.whatsapp,
                    lastMsgTime: c.ultimoMensaje,
                    fields: { ...c }
                }));

                const prompt = `
                Role: Smart Automation Engine.
                User Rule: "${rule.prompt}"
                
                Candidates Data (Batch of ${batch.length}):
                ${JSON.stringify(contextBatch)}
                
                Instructions:
                1. Identify candidates that match the User Rule.
                2. IMPORTANT: Be flexible with phone numbers. If rule says "8116038195" and candidate is "5218116038195", it's a MATCH.
                3. If MATCH = TRUE, write a friendly WhatsApp message.
                
                Respond ONLY with a JSON object:
                { "matches": [ { "id": "...", "reason": "...", "message": "..." }, ... ] }
                `;

                try {
                    const result = await model.generateContent(prompt);
                    const responseText = result.response.text();

                    // Robust JSON extraction
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) continue;

                    const decision = JSON.parse(jsonMatch[0]);
                    const matches = decision.matches || [];

                    for (const match of matches) {
                        if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                        const cand = batch.find(c => c.id === match.id);
                        if (!cand) continue;

                        const config = await getUltraMsgConfig();
                        if (config) {
                            console.log(`🚀 AI Match found for ${cand.nombre} (${cand.whatsapp})`);

                            await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, match.message);

                            await saveMessage(cand.id, {
                                from: 'bot',
                                content: match.message,
                                type: 'text',
                                timestamp: new Date().toISOString(),
                                meta: { automationId: rule.id, aiReason: match.reason }
                            });

                            await redis.set(`ai:automation:last:${cand.id}`, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);

                            messagesSent++;
                            logs.push(`✅ Enviado a ${cand.nombre}: "${match.message}"`);
                        }
                    }
                } catch (e) {
                    console.error('Batch AI Engine Error:', e.message);
                }
            }
        }

        return { success: true, evaluated, sent: messagesSent, logs };
    } catch (error) {
        console.error('Core AI Engine Error:', error);
        throw error;
    }
}
