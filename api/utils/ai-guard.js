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
        const { isProfileComplete, missingFields, lastInput, isNewFlag, candidateName } = context;

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

        // Ensure extracted data is preserved
        aiResult.extracted_data = extracted;

        return aiResult;
    }

    /**
     * Generates a deterministic recovery response based on the missing data.
     */
    static getRecoveryResponse(reason, missingFields, lastInput, isNewFlag = false, extracted = {}, candidateName = null) {
        console.log(`[AI GUARD] 💊 Generating Recovery Response for reason: ${reason}. isNew: ${isNewFlag}`);

        const firstMissing = missingFields && missingFields.length > 0 ? missingFields[0] : 'datos';

        let recoveryText = "";

        if (isNewFlag) {
            recoveryText = `¡Hola! ✨ Soy la Lic. Brenda Rodríguez de Candidatic. 🌸 Para iniciar tu registro, ¿me podrías proporcionar tu nombre completo?`;
        } else {
            // Smart Logic: If name is missing but we already have a partial name, ask for surnames
            if (firstMissing === 'Nombre Real' && candidateName && candidateName.length > 2) {
                recoveryText = `¡Súper! ✨ Ya tengo tu nombre. ¿Me podrías proporcionar tus apellidos para completar el registro? 🌸`;
            } else {
                // Simple but high-quality recovery templates
                const templates = [
                    `¡Perfecto! ✨ Para continuar con tu registro, ¿me podrías proporcionar tu ${firstMissing}?`,
                    `¡Excelente decisión! 🌸 Solo me falta tu ${firstMissing} para tener tu perfil listo. ¿Me lo pasas?`,
                    `¡Súper! ✨ Me falta el dato de tu ${firstMissing} para poder avanzar. ¿Me ayudas con eso?`
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
