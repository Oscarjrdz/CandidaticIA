import { getRedisClient, getAIAutomations, getCandidates, saveMessage } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10; // Increased safety limit
const COOLDOWN_HOURS = 24;
const BATCH_SIZE = 25; // 25 candidates per AI call for massive speedup

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

        // Get Candidates (Analyzing 500 for better performance vs timeout balance)
        const { candidates } = await getCandidates(500, 0);
        const redis = getRedisClient();

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

            logs.push(`🔍 Rule: "${rule.name}"`);

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

            // Batch Process eligible candidates
            for (let i = 0; i < eligibleCandidates.length; i += BATCH_SIZE) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                const batch = eligibleCandidates.slice(i, i + BATCH_SIZE);
                evaluated += batch.length;

                const contextBatch = batch.map(c => ({
                    id: c.id,
                    name: c.nombre,
                    phone: c.whatsapp,
                    lastMsg: c.ultimoMensaje,
                    fields: { ...c }
                }));

                const prompt = `
                Rule: "${rule.prompt}"
                Candidates: ${JSON.stringify(contextBatch)}
                
                Instruction: For each candidate, check if they fit the rule. 
                If they match, write a friendly WhatsApp message.
                
                Return JSON only:
                { "matches": [ { "id": "...", "reason": "...", "message": "..." }, ... ] }
                `;

                try {
                    const result = await model.generateContent(prompt);
                    const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '');
                    const { matches = [] } = JSON.parse(responseText);

                    for (const match of matches) {
                        if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                        const cand = batch.find(c => c.id === match.id);
                        if (!cand) continue;

                        const config = await getUltraMsgConfig();
                        if (config) {
                            await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, match.message);
                            await saveMessage(cand.id, {
                                from: 'bot',
                                content: match.message,
                                type: 'text',
                                timestamp: new Date().toISOString(),
                                meta: { automationId: rule.id, aiReason: match.reason }
                            });

                            // Set cooldown
                            await redis.set(`ai:automation:last:${cand.id}`, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);

                            messagesSent++;
                            logs.push(`✅ Sent to ${cand.nombre}: "${match.message}"`);
                        }
                    }
                } catch (e) {
                    console.error('Batch AI Error:', e.message);
                }
            }
        }

        return { success: true, evaluated, sent: messagesSent, logs };
    } catch (error) {
        console.error('AI Engine Error:', error);
        throw error;
    }
}
