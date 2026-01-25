
import { getRedisClient, updateCandidate } from './storage.js';
import { cleanNameWithAI, cleanMunicipioWithAI, detectGender } from './ai.js';

/**
 * Processes a bot message to extract and save candidate data based on automation rules.
 * @param {string} candidateId - The ID of the candidate
 * @param {string} botMessage - The message content sent by the bot
 */
export async function processBotResponse(candidateId, botMessage) {
    if (!candidateId || !botMessage) return;

    try {
        const redis = getRedisClient();
        if (!redis) return;

        // 1. Get automation rules
        const rulesJson = await redis.get('automation_rules');
        if (!rulesJson) return;

        const rules = JSON.parse(rulesJson);
        const updateData = {};
        const extraTasks = [];

        // 2. Iterate and match rules
        rules.forEach(rule => {
            if (!rule.enabled || !rule.pattern || !rule.field) return;

            try {
                const regex = new RegExp(rule.pattern, 'i');
                const match = botMessage.match(regex);

                if (match && match[1]) {
                    const extractedValue = match[1].trim().replace(/[*_]/g, '');
                    updateData[rule.field] = extractedValue;
                    console.log(`🔍 [Automations] Extracted ${rule.field}: "${extractedValue}"`);
                }
            } catch (err) {
                console.warn(`⚠️ [Automations] Invalid regex in rule ${rule.id}:`, err.message);
            }
        });

        // 3. Apply basic updates
        if (Object.keys(updateData).length > 0) {
            await updateCandidate(candidateId, updateData);
            console.log(`💾 [Automations] Updated candidate ${candidateId} with extracted data.`);

            // 4. Background: Apply AI Cleaning/Detection for specific fields
            if (updateData.nombreReal) {
                extraTasks.push((async () => {
                    const cleaned = await cleanNameWithAI(updateData.nombreReal);
                    const gender = await detectGender(cleaned);
                    await updateCandidate(candidateId, {
                        nombreReal: cleaned,
                        genero: gender !== 'Desconocido' ? gender : undefined
                    });
                    console.log(`🤖 [Automations] AI Cleaned Name: ${cleaned}, Gender: ${gender}`);
                })());
            }

            if (updateData.municipio) {
                extraTasks.push((async () => {
                    const cleaned = await cleanMunicipioWithAI(updateData.municipio);
                    await updateCandidate(candidateId, { municipio: cleaned });
                    console.log(`🤖 [Automations] AI Cleaned Municipio: ${cleaned}`);
                })());
            }

            if (updateData.categoria) {
                extraTasks.push((async () => {
                    const cleaned = await cleanCategoryWithAI(updateData.categoria);
                    await updateCandidate(candidateId, { categoria: cleaned });
                    console.log(`🤖 [Automations] AI Cleaned Categoría: ${cleaned}`);
                })());
            }

            // Run AI tasks in parallel without blocking main flow
            Promise.all(extraTasks).catch(err => console.error('❌ [Automations] AI extra tasks error:', err));
        }

    } catch (error) {
        console.error('❌ [Automations] processBotResponse error:', error);
    }
}
