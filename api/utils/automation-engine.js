import { getRedisClient, getAIAutomations, getCandidates, saveMessage } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 5;
const COOLDOWN_HOURS = 24;

export async function runAIAutomations() {
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

        const { candidates } = await getCandidates(1000, 0);
        const redis = getRedisClient();

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

            for (const candidate of candidates) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                const lastAutoKey = `ai:automation:last:${candidate.id}`;
                const lastRun = await redis.get(lastAutoKey);
                if (lastRun) continue;

                const context = {
                    name: candidate.nombre,
                    phone: candidate.whatsapp,
                    lastMessageTime: candidate.ultimoMensaje,
                    fields: { ...candidate }
                };
                delete context.fields.messages;

                const prompt = `
                Role: You are an impartial filtering AI for a recruiting agency.
                Task: Evaluate if the Candidate matches the User's Rule.
                
                User Rule: "${rule.prompt}"
                
                Candidate Data:
                ${JSON.stringify(context)}
                
                Instructions:
                1. STRICTLY evaluate if the candidate fits the rule.
                2. If MATCH = TRUE, draft a friendly, short WhatsApp message.
                
                Respond ONLY in JSON:
                {
                  "match": boolean,
                  "reason": "short explanation",
                  "message": "content of message (if match)"
                }
                `;

                try {
                    const result = await model.generateContent(prompt);
                    const decision = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, ''));
                    evaluated++;

                    if (decision.match) {
                        const config = await getUltraMsgConfig();
                        if (config) {
                            await sendUltraMsgMessage(config.instanceId, config.token, candidate.whatsapp, decision.message);
                            await saveMessage(candidate.id, {
                                from: 'bot',
                                content: decision.message,
                                type: 'text',
                                timestamp: new Date().toISOString(),
                                meta: { automationId: rule.id }
                            });
                            await redis.set(lastAutoKey, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);
                            messagesSent++;
                            logs.push(`✅ Sent to ${candidate.nombre}: "${decision.message}"`);
                        }
                    }
                } catch (e) {
                    console.error(`AI Filter Error for ${candidate.nombre}:`, e.message);
                }
            }
        }

        return { success: true, evaluated, sent: messagesSent, logs };
    } catch (error) {
        console.error('AI Engine Error:', error);
        throw error;
    }
}
