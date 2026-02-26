/**
 * 🛡️ AI GUARDRAIL (Meta-Level Reliability)
 * Ensures that no AI response ever result in silence if the mission is incomplete.
 */

export class AIGuard {
    /**
     * Validates an AI response and returns a sanitized result or a recovery response.
     * @param {Object} aiResult - The result from the LLM (parsed JSON).
     * @param {Object} context - Contextual data (candidate status, missing fields).
     * @returns {Object} Validated and recovered AI response.
     */
    static validate(aiResult, context) {
        const { isProfileComplete, missingFields, lastInput, isNewFlag, candidateName, lastBotMessages } = context;

        console.log(`[AI GUARD] 🛡️ Validating response. Profile Complete: ${isProfileComplete} | New: ${isNewFlag}`);

        // Extract any data present even if response_text is missing/malformed
        const extracted = aiResult?.extracted_data || {};

        // 1. Basic JSON/Null Check
        if (!aiResult) {
            return this.getRecoveryResponse("FALLBACK_NULL", missingFields, lastInput, isNewFlag, extracted, candidateName);
        }

        const responseText = aiResult.response_text;
        const hasEmptyResponse = !responseText || responseText.trim() === '' || responseText === 'null' || responseText === 'undefined';

        // 2. Silence Detection for Incomplete Profiles
        if (hasEmptyResponse && !isProfileComplete) {
            console.warn(`[AI GUARD] 🚨 Silence detected on incomplete profile. Triggering Recovery.`);
            return this.getRecoveryResponse("FALLBACK_SILENCE", missingFields, lastInput, isNewFlag, extracted, candidateName);
        }

        // 3. Duplicate Detection (Anti-Loop)
        if (responseText && lastBotMessages && lastBotMessages.length > 0) {
            const normalizedResp = responseText.trim().toLowerCase();
            const isDuplicate = lastBotMessages.some(m => m.toLowerCase() === normalizedResp);
            if (isDuplicate) {
                console.warn(`[AI GUARD] 🔄 Repetition detected: "${responseText.substring(0, 30)}...". Triggering Recovery.`);
                return this.getRecoveryResponse("FALLBACK_REPETITION", missingFields, lastInput, isNewFlag, extracted, candidateName);
            }
        }

        // 4. Pattern-Based Greeting Loop Detection (Identity Guard)
        if (!isNewFlag && responseText) {
            const lowerResp = responseText.toLowerCase();
            const identityPatterns = [
                /soy la lic\.? brenda/i,
                /reclutadora de candidatic/i
                // removed /candidatic/i to avoid false positives on legitimate mentions
            ];
            const hasIdentity = identityPatterns.some(p => p.test(lowerResp));

            if (hasIdentity) {
                console.warn(`[AI GUARD] 🆔 Identity repetition detected in active chat. Blocking greeting.`);
                return this.getRecoveryResponse("FALLBACK_IDENTITY_REPETITION", missingFields, lastInput, isNewFlag, extracted, candidateName);
            }
        }

        // Ensure extracted data is preserved
        aiResult.extracted_data = extracted;

        return aiResult;
    }

    /**
     * Generates a deterministic recovery response based on the missing data.
     */
    static getRecoveryResponse(reason, missingFields, lastInput, isNewFlag = false, extracted = {}, candidateName = null) {
        console.log(`[AI GUARD] 💊 Generating Recovery Response for reason: ${reason}. isNew: ${isNewFlag}`);

        // 🛡️ [GENDER SUPPRESSION]: Ensure fallback never asks for gender
        const safeMissing = (missingFields || []).filter(f => f !== 'Género' && f !== 'genero');
        const firstMissing = safeMissing.length > 0 ? safeMissing[0] : 'datos';

        let recoveryText = "";

        if (isNewFlag && reason !== 'FALLBACK_REPETITION' && reason !== 'FALLBACK_IDENTITY_REPETITION') {
            recoveryText = `¡Hola! ✨ Soy la Lic. Brenda Rodríguez de Candidatic. 🌸 Para iniciar tu registro, ¿me podrías proporcionar tu nombre completo?`;
        } else {
            const nameWords = candidateName ? candidateName.trim().split(/\s+/).length : 0;
            const firstName = candidateName ? candidateName.split(/\s+/)[0] : null;

            // Smart Logic: Only ask for surnames if we *only* have a first name (1 word)
            if (firstMissing === 'Nombre Real' && nameWords === 1) {
                recoveryText = `¡Súper, ${firstName}! ✨ Ya tengo tu nombre. ¿Me podrías proporcionar tus apellidos para completar tu registro? 🌸`;
            } else if (reason === 'FALLBACK_REPETITION' || reason === 'FALLBACK_IDENTITY_REPETITION') {
                // Specific variation for repetition to break the loop
                const variationTemplates = [
                    `${firstName ? firstName + ', p' : 'P'}ara tu registro aún necesito tu ${firstMissing}. ¿Me ayudas con eso? ✨`,
                    `Solo me falta tu ${firstMissing} para avanzar. ¿Me lo pasas? 🌸`,
                    `¡Súper! 🌸 Me falta confirmar tu ${firstMissing} para seguir. ✨`
                ];
                recoveryText = variationTemplates[Math.floor(Math.random() * variationTemplates.length)];
            } else {
                // Simple but high-quality recovery templates (ELOCUENT, WARM & BRANDED)
                const templates = [
                    `¡Súper! ✨ ${firstName ? firstName + ', p' : 'P'}ara seguir avanzando y que ya quedes en el sistema, ¿me podrías pasar tu ${firstMissing}? 😉🌸`,
                    `${firstName ? '¡' + firstName + '! ✨ ' : ''}Solo me falta el detalle de tu ${firstMissing} para decirte que ya estás dentro. 🤭 ¿Me lo proporcionas? ✨`,
                    `¡Casi lo tenemos! 💖 ${firstName ? firstName + ', solo' : 'Solo'} necesito saber tu ${firstMissing} para encontrarte la mejor vacante hoy mismo. 😉✨`
                ];
                recoveryText = templates[Math.floor(Math.random() * templates.length)];
            }
        }

        return {
            response_text: recoveryText,
            thought_process: `RECOVERY_TRIGGERED: ${reason}. Manual fallback due to AI failure.`,
            reaction: isNewFlag ? '✨' : null, // Only react on first message to reduce spark spam
            extracted_data: extracted, // 🧬 CRITICAL: Keep what the AI *did* manage to extract
            gratitude_reached: false,
            close_conversation: false,
            recovery_active: true
        };
    }

    /**
     * Sanitizes raw text from LLM to ensure it's valid JSON before parsing.
     */
    static sanitizeJSON(rawText) {
        if (!rawText) return null;
        try {
            const sanitized = rawText
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/```\s*$/i, '')
                .trim();
            return JSON.parse(sanitized);
        } catch (e) {
            console.error("[AI GUARD] ❌ JSON Sanitization failed:", e.message);
            // Attempt a more aggressive regex fix if needed
            return null;
        }
    }
}
