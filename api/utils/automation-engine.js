import { getRedisClient, getAIAutomations, getCandidates, saveMessage } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;
const BATCH_SIZE = 40; // Increased batch size for Gemini 2.0 efficiency

export async function runAIAutomations(bypassCooldown = false) {
    const logs = [];
    let evaluatedCount = 0;
    let messagesSent = 0;

    try {
        console.log(`🤖 AI Engine: Starting run (DeepScan: ${bypassCooldown})`);

        if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

        const automations = await getAIAutomations();
        const activeRules = automations.filter(a => a.active);

        if (activeRules.length === 0) {
            return { success: true, message: 'No active AI automations', evaluated: 0, sent: 0, logs: [] };
        }

        const config = await getUltraMsgConfig();
        if (!config || !config.instanceId || !config.token) throw new Error('Missing UltraMsg Config');

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // Deep Scan vs Standard Scan
        const scanLimit = bypassCooldown ? 5000 : 2000;
        const { candidates } = await getCandidates(scanLimit, 0);
        const redis = getRedisClient();

        console.log(`🤖 AI Engine: Scanning ${candidates.length} candidates for ${activeRules.length} rules.`);

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

            logs.push(`🔍 Rule: "${rule.name}"`);

            // Cooldown Filter
            let eligible = candidates;
            if (!bypassCooldown) {
                const cooldownResults = await Promise.all(
                    candidates.map(async c => {
                        const hasCooldown = await redis.get(`ai:automation:last:${c.id}`);
                        return { c, hasCooldown };
                    })
                );
                eligible = cooldownResults.filter(r => !r.hasCooldown).map(r => r.c);
            }

            // Batch Processing
            for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                const batch = eligible.slice(i, i + BATCH_SIZE);
                evaluatedCount += batch.length;

                const contextBatch = batch.map(c => ({
                    id: c.id,
                    name: c.nombre,
                    whatsapp: c.whatsapp,
                    lastIn: c.ultimoMensaje,
                    lastOut: c.lastOutgoingMessage,
                    status: c.status
                }));

                const prompt = `
                Rule: "${rule.prompt}"
                Candidates Batch: ${JSON.stringify(contextBatch)}
                
                Instruction:
                1. Identify matches for the rule. 
                2. If rule mentions a number (e.g. 8116038195), match it regardless of country prefixes (52, 521, etc).
                3. If match = true, write a natural WhatsApp message.
                
                Respond ONLY in JSON format:
                { "matches": [ { "id": "...", "reason": "...", "message": "..." } ] }
                `;

                try {
                    const result = await model.generateContent(prompt);
                    const responseText = result.response.text();
                    const cleanJson = responseText.match(/\{[\s\S]*\}/)?.[0];
                    if (!cleanJson) continue;

                    const { matches = [] } = JSON.parse(cleanJson);

                    for (const match of matches) {
                        if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                        const cand = batch.find(c => c.id === match.id);
                        if (!cand) continue;

                        console.log(`✨ AI MATCH Rule[${rule.name}] -> Candidate[${cand.nombre}]: ${match.reason}`);

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
                        logs.push(`✅ Sent to ${cand.nombre}: "${match.message}"`);
                    }
                } catch (e) {
                    console.error('Batch Execution Error:', e.message);
                }
            }
        }

        return { success: true, evaluated: evaluatedCount, sent: messagesSent, logs };
    } catch (error) {
        console.error('AI Engine Core Error:', error);
        throw error;
    }
}
