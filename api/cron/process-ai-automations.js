import { getRedisClient, getAIAutomations, getCandidates, saveMessage, updateCandidate } from '../../api/utils/storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../../api/whatsapp/utils.js';

// --- CONFIGURATION ---
const SAFETY_LIMIT_PER_RUN = 5; // Max messages per cron run to prevent spam
const COOLDOWN_HOURS = 24; // Candidates can't receive automation messages too often

export default async function handler(req, res) {
    // Basic Security
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const automations = await getAIAutomations();
        const activeRules = automations.filter(a => a.active);

        if (activeRules.length === 0) {
            return res.status(200).json({ message: 'No active AI automations' });
        }

        // Initialize AI
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // Get Candidates (Latest 100 for evaluation)
        const { candidates } = await getCandidates(100, 0); // Analyze recent batch
        const redis = getRedisClient();

        let messagesSent = 0;
        let evaluated = 0;
        const logs = [];

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

            logs.push(`🔍 Evaluating Rule: "${rule.name}"`);

            for (const candidate of candidates) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                // 1. Safety Check: Cooldown
                const lastAutoKey = `ai:automation:last:${candidate.id}`;
                const lastRun = await redis.get(lastAutoKey);
                if (lastRun) continue; // Skip if recently messaged by ANY automation

                // 2. Prepare Context for AI
                const context = {
                    name: candidate.nombre,
                    phone: candidate.whatsapp,
                    lastMessageTime: candidate.ultimoMensaje,
                    fields: { ...candidate } // Include all dynamic fields
                };
                delete context.fields.messages; // Reduce token usage

                // 3. The "Smart Sieve" Prompt
                const prompt = `
                Role: You are an impartial filtering AI for a recruiting agency.
                Task: Evaluate if the Candidate matches the User's Rule.
                
                User Rule: "${rule.prompt}"
                
                Candidate Data:
                ${JSON.stringify(context)}
                
                Instructions:
                1. STRICTLY evaluate if the candidate fits the rule.
                2. If the rule says "didn't reply in 2 days", check 'lastMessageTime'.
                3. If the rule says "missing CV", check if 'cv' field is missing/empty.
                4. If MATCH = TRUE, draft a friendly, short WhatsApp message.
                
                Respond ONLY in JSON:
                {
                  "match": boolean,
                  "reason": "short explanation",
                  "message": "content of message (if match)"
                }
                `;

                try {
                    const result = await model.generateContent(prompt);
                    const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, ''); // Clean markdown
                    const decision = JSON.parse(responseText);

                    evaluated++;

                    if (decision.match) {
                        // 4. Execute Action
                        console.log(`✨ AI Automation MATCH [${candidate.nombre}]: ${decision.reason}`);

                        // Send Message
                        const config = await getUltraMsgConfig();
                        if (config) {
                            await sendUltraMsgMessage(config.instanceId, config.token, candidate.whatsapp, decision.message);

                            // Log & Cooldown
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

        return res.status(200).json({
            success: true,
            evaluated,
            sent: messagesSent,
            logs
        });

    } catch (error) {
        console.error('AI Automation Cron Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
