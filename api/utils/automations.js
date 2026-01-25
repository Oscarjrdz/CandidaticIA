
import { getRedisClient, updateCandidate } from './storage.js';
import { cleanNameWithAI, cleanMunicipioWithAI, cleanCategoryWithAI, detectGender } from './ai.js';

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

        // 3. Apply basic updates (Raw extraction)
        if (Object.keys(updateData).length > 0) {
            console.log(`💾 [Automations] Saving raw update for ${candidateId}:`, updateData);
            await updateCandidate(candidateId, updateData);

            // 4. AI Cleaning/Detection for specific fields
            if (updateData.nombreReal) {
                extraTasks.push((async () => {
                    console.log(`🤖 [Automations] Cleaning name: "${updateData.nombreReal}"...`);
                    const cleaned = await cleanNameWithAI(updateData.nombreReal);
                    const gender = await detectGender(cleaned);
                    await updateCandidate(candidateId, {
                        nombreReal: cleaned,
                        genero: gender !== 'Desconocido' ? gender : undefined
                    });
                    console.log(`✅ [Automations] Name cleaned: "${cleaned}" (${gender})`);
                })());
            }

            if (updateData.municipio) {
                extraTasks.push((async () => {
                    console.log(`🤖 [Automations] Cleaning municipio: "${updateData.municipio}"...`);
                    const cleaned = await cleanMunicipioWithAI(updateData.municipio);
                    await updateCandidate(candidateId, { municipio: cleaned });
                    console.log(`✅ [Automations] Municipio cleaned: "${cleaned}"`);
                })());
            }

            if (updateData.categoria) {
                extraTasks.push((async () => {
                    console.log(`🤖 [Automations] Cleaning categoria: "${updateData.categoria}"...`);
                    const cleaned = await cleanCategoryWithAI(updateData.categoria);
                    await updateCandidate(candidateId, { categoria: cleaned });
                    console.log(`✅ [Automations] Categoria cleaned: "${cleaned}"`);
                })());
            }

            if (updateData.tieneEmpleo) {
                extraTasks.push((async () => {
                    console.log(`🤖 [Automations] Cleaning employment status: "${updateData.tieneEmpleo}"...`);
                    const cleaned = await cleanEmploymentStatusWithAI(updateData.tieneEmpleo);
                    await updateCandidate(candidateId, { tieneEmpleo: cleaned });
                    console.log(`✅ [Automations] Employment status cleaned: "${cleaned}"`);
                })());
            }

            // Wait for all AI tasks to finish to ensure consistency in serverless
            if (extraTasks.length > 0) {
                console.log(`⏳ [Automations] Waiting for ${extraTasks.length} AI cleaning tasks...`);
                await Promise.all(extraTasks).catch(err => console.error('❌ [Automations] AI tasks error:', err));
            }
        } else {
            console.log('ℹ️ [Automations] No matching patterns found in bot response.');
        }

    } catch (error) {
        console.error('❌ [Automations] processBotResponse error:', error);
    }
}
