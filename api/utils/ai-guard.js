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
            recoveryText = `¡Hola! 👋 Soy la Lic. Brenda Rodríguez de Candidatic. 🌸 Para iniciar tu registro, ¿me podrías proporcionar tu nombre completo?`;
        } else if (lastInput && /^(si|claro|por supuesto|ok|sip|ayudo|te ayudo|adelante|dime|está bien|esta bien|bueno)$/i.test(lastInput.trim().toLowerCase())) {
            // 🌸 INTENT-TO-HELP HANDOVER: If user said "Yes", "Sure", etc.
            const templates = [
                `¡Qué bien! ✨ Cuéntame, ¿cuál es tu ${firstMissing}? 🤭`,
                `¡Excelente! 🌟 Dime tu ${firstMissing} para avanzar. ✨`,
                `¡Qué alegría! 💖 ¿Me pasas tu ${firstMissing} porfa? 🌸`,
                `¡Perfecto! 😉 ¿Me podrías decir tu ${firstMissing}? ✨`
            ];
            recoveryText = templates[Math.floor(Math.random() * templates.length)];
        } else {
            const nameWords = candidateName ? candidateName.trim().split(/\s+/).filter(w => w.length > 0).length : 0;
            const firstName = (candidateName && nameWords > 0) ? candidateName.trim().split(/\s+/)[0] : null;

            // Smart Logic: Only ask for surnames if we *only* have a first name (1 word)
            if (firstMissing === 'Apellidos' || (firstMissing === 'Nombre completo' && nameWords === 1)) {
                const namePart = firstName ? `, ${firstName}` : '';
                const templates = [
                    `¡Excelente${namePart}! ✨ Ya tengo tu nombre. ¿Me podrías proporcionar tus apellidos para completar tu registro? 🌸`,
                    `¡Mucho gusto${namePart}! 💖 Solo me faltan tus apellidos para que ya quedes en el sistema. 🤭 ¿Me los pasas? ✨`,
                    `¡Qué bonito nombre${namePart}! 🌟 ¿Podrías decirme tus apellidos? Es el último pasito. 😉✨`,
                    `¡Perfecto${namePart}! ✨ Para terminar, ¿cuáles son tus apellidos? 🌸`
                ];
                recoveryText = templates[Math.floor(Math.random() * templates.length)];
            } else if (reason === 'FALLBACK_REPETITION' || reason === 'FALLBACK_IDENTITY_REPETITION') {
                // Specific variation for repetition to break the loop - DIVERSIFIED
                const variationTemplates = [
                    `${firstName ? firstName + ', d' : 'D'}ime, ¿me puedes pasar tu ${firstMissing}? Es para tu registro. ✨`,
                    `Para seguir, ¿cuál es tu ${firstMissing}? 😉🌸`,
                    `Oye, cuéntame sobre tu ${firstMissing}, ¡me falta ese dato! ✨`,
                    `¡Qué bien! ✨ Pero me falta confirmar tu ${firstMissing}. 🌸 ¿Me lo dices?`
                ];
                recoveryText = variationTemplates[Math.floor(Math.random() * variationTemplates.length)];
            } else {
                // HIGH VARIETY RECOVERY TEMPLATES (NON-REPETITIVE, BRANDED)
                const connector = (firstMissing === 'Apellidos') ? 'tus' : 'tu';
                const templates = [
                    `¡Excelente! ✨ ${firstName ? firstName + ', p' : 'P'}ara avanzar con tu registro, ¿me podrías proporcionar ${connector} ${firstMissing}? 😉🌸`,
                    `${firstName ? '¡' + firstName + '! ✨ ' : ''}Me hace falta saber ${connector} ${firstMissing} para tener tu perfil listo en el sistema. 🤭 ¿Me ayudas con eso? ✨`,
                    `¡Casi lo tenemos! 💖 ${firstName ? firstName + ', n' : 'N'}ecesito el dato de ${connector} ${firstMissing} para encontrarte la mejor vacante hoy mismo. 😉✨`,
                    `¿Me podrías decir ${connector} ${firstMissing}? ✨ Es el último paso para entrar al proceso. 🌸`,
                    `¡Qué alegría! 🌟 Para que ya quedes en la base de datos, dime ${connector} ${firstMissing}. 🤭✨`,
                    `¡Vas excelente! ✨ ${firstName ? firstName + ', d' : 'D'}ime ${connector} ${firstMissing} para decirte qué vacantes tenemos disponibles. 🌸`,
                    `Oye, ${firstName || 'un detalle'}, ¿cuál es ${connector} ${firstMissing}? ✨ Me sirve mucho para tu registro. 😉`,
                    `¡Perfecto! 💖 Ya casi acabamos. ¿Me pasas ${connector} ${firstMissing}? ✨🌸`
                ];
                recoveryText = templates[Math.floor(Math.random() * templates.length)];
            }
        }

        const greetingReturn = lastInput && /hola|buen(as)? (dia|tarde|noche)|que tal/i.test(lastInput.toLowerCase()) ? "¡Hola! 👋 " : "";
        return {
            response_text: `${greetingReturn}${recoveryText}`,
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
