import { getRedisClient, getAIAutomations, getCandidates, saveMessage } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;

export async function runAIAutomations(bypassCooldown = false) {
    const logs = [];
    let evaluatedCount = 0;
    let messagesSent = 0;

    try {
        console.log(`🤖 AI Engine: Starting Two-Pass Run (Manual: ${bypassCooldown})`);

        if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

        const automations = await getAIAutomations();
        const activeRules = automations.filter(a => a.active);

        if (activeRules.length === 0) {
            return { success: true, message: 'No active rules', evaluated: 0, sent: 0, logs: [] };
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
            logs.push(`🔍 Analizando regla: "${rule.name}"`);

            // --- PASS 1: Entity Extraction ---
            // We ask Gemini what to look for in the database to narrow down candidates.
            const extractionPrompt = `
            Extract search terms from this automation rule: "${rule.prompt}"
            I need specific:
            - phone: Any phone number mentioned.
            - name: Any specific person's name.
            - status: Any status mentioned (e.g. "active", "missing cv").
            
            Respond ONLY in JSON:
            { "phone": string|null, "name": string|null, "status": string|null }
            `;

            let entities = { phone: null, name: null, status: null };
            try {
                const extractionResult = await model.generateContent(extractionPrompt);
                const jsonText = extractionResult.response.text().match(/\{[\s\S]*\}/)?.[0];
                if (jsonText) entities = JSON.parse(jsonText);
            } catch (e) {
                console.error('Extraction Error:', e);
            }

            // --- PASS 2: Search & Filter ---
            let targetCandidates = [];

            if (entities.phone) {
                // If a phone is mentioned, it's a sniper shot.
                const cleanPhone = entities.phone.replace(/\D/g, '');
                logs.push(`🎯 Sniper mode: Buscando número ${cleanPhone}`);

                // Try searching by number
                const { candidates: searchRes } = await getCandidates(10, 0, cleanPhone);
                targetCandidates = searchRes;
            } else if (entities.name) {
                logs.push(`🎯 Buscando por nombre: ${entities.name}`);
                const { candidates: searchRes } = await getCandidates(50, 0, entities.name);
                targetCandidates = searchRes;
            } else {
                // Broad rule (e.g. "inactive for 2 days"). Scan recent 500.
                logs.push(`📡 Broad scan: Analizando últimos 500 candidatos activos`);
                const { candidates: scanRes } = await getCandidates(500, 0);
                targetCandidates = scanRes;
            }

            if (targetCandidates.length === 0) {
                logs.push(`⚠️ No se encontraron candidatos que coincidan con los criterios de búsqueda inicial.`);
                continue;
            }

            // --- PASS 3: Final Intelligence Evaluation ---
            const redis = getRedisClient();

            // Filter cooldown if needed
            let eligible = targetCandidates;
            if (!bypassCooldown) {
                const results = await Promise.all(targetCandidates.map(async c => {
                    const has = await redis.get(`ai:automation:last:${c.id}`);
                    return has ? null : c;
                }));
                eligible = results.filter(c => c !== null);
            }

            evaluatedCount += eligible.length;

            if (eligible.length === 0) {
                logs.push(`🛡️ Los candidatos encontrados están en periodo de enfriamiento (cooldown).`);
                continue;
            }

            const promptBatch = eligible.map(c => ({ id: c.id, name: c.nombre, phone: c.whatsapp, fields: { ...c } }));

            const finalPrompt = `
            Evaluate these candidates for the rule: "${rule.prompt}"
            Candidates: ${JSON.stringify(promptBatch)}
            
            Confirm match and write a natural WhatsApp message.
            Respond ONLY in JSON:
            { "matches": [ { "id": "...", "reason": "...", "message": "..." } ] }
            `;

            try {
                const finalResult = await model.generateContent(finalPrompt);
                const finalJson = finalResult.response.text().match(/\{[\s\S]*\}/)?.[0];
                const { matches = [] } = JSON.parse(finalJson);

                for (const match of matches) {
                    if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                    const cand = eligible.find(c => c.id === match.id);
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
                        await redis.set(`ai:automation:last:${cand.id}`, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);
                        messagesSent++;
                        logs.push(`✨ Match encontrado: Envío mensaje a ${cand.nombre}`);
                    }
                }
            } catch (e) {
                console.error('Final Evaluation Error:', e);
            }
        }

        return { success: true, evaluated: evaluatedCount, sent: messagesSent, logs };
    } catch (error) {
        console.error('Two-Pass Engine Error:', error);
        throw error;
    }
}
