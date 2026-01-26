import { getRedisClient, getAIAutomations, getCandidates, saveMessage, getCandidateByPhone } from './storage.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const SAFETY_LIMIT_PER_RUN = 10;
const COOLDOWN_HOURS = 24;
const BATCH_SIZE = 25;

/**
 * runAIAutomations
 * Zuckerberg Style: Optimized for speed and robustness against timeouts.
 * @param {boolean} isManual - If true, bypasses cooldown and focuses on sniper matches.
 */
export async function runAIAutomations(isManual = false) {
    const logs = [];
    let evaluatedCount = 0;
    let messagesSent = 0;

    try {
        console.log(`🤖 AI Engine: Starting Run (Mode: ${isManual ? 'MANUAL' : 'CRON'})`);

        if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

        const automations = await getAIAutomations();
        const activeRules = automations.filter(a => a.active);

        if (activeRules.length === 0) {
            return { success: true, message: 'No rules active', evaluated: 0, sent: 0, logs: ['No hay reglas activas.'] };
        }

        const config = await getUltraMsgConfig();
        if (!config || !config.instanceId || !config.token) throw new Error('Missing UltraMsg Config');

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        for (const rule of activeRules) {
            if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;
            logs.push(`🔍 Analizando: "${rule.name}"`);

            // --- PASS 1: Intention Detection ---
            const extractionPrompt = `
            Extract search terms from this rule: "${rule.prompt}"
            Return JSON: { "phone": string|null, "name": string|null }
            `;

            let entities = { phone: null, name: null };
            try {
                const extractionResult = await model.generateContent(extractionPrompt);
                const jsonText = extractionResult.response.text().match(/\{[\s\S]*\}/)?.[0];
                if (jsonText) entities = JSON.parse(jsonText);
            } catch (e) { console.error('Extraction Error:', e); }

            // --- PASS 2: Intelligent Candidate Selection ---
            let targetCandidates = [];

            if (entities.phone) {
                const cleanPhone = entities.phone.replace(/\D/g, '');
                logs.push(`🎯 Sniper: Buscando número ${cleanPhone}...`);
                const candidate = await getCandidateByPhone(cleanPhone);
                if (candidate) {
                    targetCandidates = [candidate];
                    logs.push(`✅ Candidato encontrado: ${candidate.nombre}`);
                } else {
                    logs.push(`⚠️ No se encontró el número ${cleanPhone} en la base de datos.`);
                }
            } else if (entities.name) {
                logs.push(`🎯 Buscando por nombre: ${entities.name}...`);
                const { candidates: searchRes } = await getCandidates(20, 0, entities.name);
                targetCandidates = searchRes;
            } else {
                // Broad rules: Scaled down for manual runs to prevent Timeouts
                const scanLimit = isManual ? 100 : 500;
                logs.push(`📡 Escaneo ${isManual ? 'Rápido' : 'Normal'}: Analizando últimos ${scanLimit} candidatos`);
                const { candidates: scanRes } = await getCandidates(scanLimit, 0);
                targetCandidates = scanRes;
            }

            if (targetCandidates.length === 0) continue;

            // --- PASS 3: AI Evaluation Batching ---
            const redis = getRedisClient();

            // Filter cooldown if CRON mode
            let eligible = targetCandidates;
            if (!isManual) {
                const results = await Promise.all(targetCandidates.map(async c => {
                    const has = await redis.get(`ai:automation:last:${c.id}`);
                    return has ? null : c;
                }));
                eligible = results.filter(c => c !== null);
            }

            for (let j = 0; j < eligible.length; j += BATCH_SIZE) {
                if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                const batch = eligible.slice(j, j + BATCH_SIZE);
                evaluatedCount += batch.length;

                const contextBatch = batch.map(c => ({
                    id: c.id,
                    nombre: c.nombre,
                    whatsapp: c.whatsapp,
                    status: c.status,
                    ultimoMsg: c.ultimoMensaje
                }));

                const finalPrompt = `
                Rule: "${rule.prompt}"
                Candidates: ${JSON.stringify(contextBatch)}
                
                Instruction: If match=true, write a short, friendly WhatsApp message.
                Respond ONLY JSON: { "matches": [ { "id": "...", "reason": "...", "message": "..." } ] }
                `;

                try {
                    const finalResult = await model.generateContent(finalPrompt);
                    const finalJson = finalResult.response.text().match(/\{[\s\S]*\}/)?.[0];
                    if (!finalJson) continue;

                    const { matches = [] } = JSON.parse(finalJson);

                    for (const match of matches) {
                        if (messagesSent >= SAFETY_LIMIT_PER_RUN) break;

                        const cand = batch.find(c => c.id === match.id);
                        if (!cand) continue;

                        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, match.message);
                        await saveMessage(cand.id, {
                            from: 'bot',
                            content: match.message,
                            type: 'text',
                            timestamp: new Date().toISOString(),
                            meta: { automationId: rule.id, aiReason: match.reason }
                        });

                        // Set 24h cooldown
                        await redis.set(`ai:automation:last:${cand.id}`, new Date().toISOString(), 'EX', COOLDOWN_HOURS * 3600);

                        messagesSent++;
                        logs.push(`✨ Enviado a ${cand.nombre}: "${match.message}"`);
                    }
                } catch (e) {
                    console.error('Final Evaluator Error:', e.message);
                    logs.push(`❌ Error evaluando lote de candidatos.`);
                }
            }
        }

        if (messagesSent === 0 && evaluatedCount > 0) {
            logs.push(`ℹ️ Análisis completo. Ningún candidato cumplió con los criterios de la IA en esta ejecución.`);
        }

        return { success: true, evaluated: evaluatedCount, sent: messagesSent, logs };
    } catch (error) {
        console.error('Core AI Engine Error:', error);
        return { success: false, error: error.message, logs: [`❌ Error fatal: ${error.message}`] };
    }
}
