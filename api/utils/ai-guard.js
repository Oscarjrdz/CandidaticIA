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
        const { isProfileComplete, missingFields, lastInput, isNewFlag, candidateName, lastBotMessages, categoriesList } = context;

        console.log(`[AI GUARD] 🛡️ Validating response. Profile Complete: ${isProfileComplete} | New: ${isNewFlag}`);

        // Extract any data present even if response_text is missing/malformed
        const extracted = aiResult?.extracted_data || {};

        // 1. Basic JSON/Null Check
        if (!aiResult) {
            return this.getRecoveryResponse("FALLBACK_NULL", missingFields, lastInput, isNewFlag, extracted, candidateName, categoriesList);
        }

        const responseText = aiResult.response_text;
        const hasEmptyResponse = !responseText || responseText.trim() === '' || responseText === 'null' || responseText === 'undefined';

        // 2. Silence Detection for Incomplete Profiles
        if (hasEmptyResponse && !isProfileComplete) {
            console.warn(`[AI GUARD] 🚨 Silence detected on incomplete profile. Triggering Recovery.`);
            return this.getRecoveryResponse("FALLBACK_SILENCE", missingFields, lastInput, isNewFlag, extracted, candidateName, categoriesList);
        }

        // 3. Duplicate Detection (Anti-Loop)
        if (responseText && lastBotMessages && lastBotMessages.length > 0) {
            const normalizedResp = responseText.trim().toLowerCase();
            const isDuplicate = lastBotMessages.some(m => m.toLowerCase() === normalizedResp);
            if (isDuplicate) {
                console.warn(`[AI GUARD] 🔄 Repetition detected: "${responseText.substring(0, 30)}...". Triggering Recovery.`);
                return this.getRecoveryResponse("FALLBACK_REPETITION", missingFields, lastInput, isNewFlag, extracted, candidateName, categoriesList);
            }
        }

        // 4. Pattern-Based Greeting Loop Detection (Identity Guard)
        if (!isNewFlag && responseText) {
            const lowerResp = responseText.toLowerCase();
            const identityPatterns = [
                /soy la lic\.? brenda/i,
                /reclutadora de candidatic/i
            ];
            const hasIdentity = identityPatterns.some(p => p.test(lowerResp));

            if (hasIdentity) {
                console.warn(`[AI GUARD] 🆔 Identity repetition detected in active chat. Blocking greeting.`);
                return this.getRecoveryResponse("FALLBACK_IDENTITY_REPETITION", missingFields, lastInput, isNewFlag, extracted, candidateName, categoriesList);
            }
        }

        // 5. 🎡 Category Presence Guard
        const safeMissing = (missingFields || []).map(f => f.toLowerCase().trim());
        const isCategoryNext = safeMissing.length > 0 && (safeMissing[0].includes('categor') || safeMissing[0] === 'categoria');

        if (isCategoryNext && responseText && !responseText.includes('✅') && !responseText.includes('🤔')) {
            console.warn(`[AI GUARD] 🎡 Category is next required field but missing checkmarks in response. Triggering Recovery.`);
            return this.getRecoveryResponse("FALLBACK_MISSING_CATEGORIES", missingFields, lastInput, isNewFlag, extracted, candidateName, categoriesList);
        }

        // Ensure extracted data is preserved
        aiResult.extracted_data = extracted;

        // 6. 🌸 Compliment Intercept (Successful LLM Response)
        // If the LLM successfully generated a response but the user was flirting, it often sounds robotic (e.g., "Eso suena divertido, pero...").
        // We override the robotic preamble with a natural flirty AI-Guard phrase.
        const isCompliment = lastInput && /hermosa|guapa|linda|bella|preciosa|chula|hermoso|guapo|novio|salir conmigo|casamos/i.test(lastInput.toLowerCase());
        if (isCompliment && aiResult.response_text && !aiResult.response_text.includes('cosas preguntas')) {
            let cleanedText = aiResult.response_text
                .replace(/^(?:Gracias por|Eso suena|Entiendo|Me halagas|Agradezco|Vamos a|No es posible|Soy una IA|Soy un asistente|soy un bot)[^\.]*(?:\.|,)/i, '')
                .trim();

            // Strip trailing connectors uncapitalized
            cleanedText = cleanedText.replace(/^(?:pero|así que|entonces|sin embargo)\b/i, '').trim();
            cleanedText = cleanedText.replace(/^[,.\s]+/, '').trim();

            // Capitalize first letter
            if (cleanedText.length > 0) {
                cleanedText = cleanedText.charAt(0).toUpperCase() + cleanedText.slice(1);
            }

            // Only prepend if the LLM didn't already output a huge block (like the categories list)
            // Or if it did, just confidently prepend it.
            aiResult.response_text = `¡Ay, qué cosas preguntas! 🤭✨ Pero enfoquémonos en encontrar el mejor empleo para ti...\n\n${cleanedText}`;
        }

        return aiResult;
    }

    /**
     * Generates a deterministic recovery response based on the missing data.
     */
    static getRecoveryResponse(reason, missingFields, lastInput, isNewFlag = false, extracted = {}, candidateName = null, categoriesList = "") {
        console.log(`[AI GUARD] 💊 Generating Recovery Response for reason: ${reason}. isNew: ${isNewFlag}`);

        // 🛡️ [GENDER SUPPRESSION (ANTI-DISCRIMINATION)]: Ensure fallback never asks for gender explicitly.
        // It must be inferred quietly by the AI.
        const safeMissing = (missingFields || []).filter(f => f !== 'Género' && f !== 'genero');

        // 🌸 SOCIAL FALLBACK: If profile is complete, don't ask for data!
        // Instead, we force a silent transition (close_conversation: true, no text)
        // so the system naturally hands over to Bypass or next steps without the AI
        // hallucinating a random farewell summary of vacancies.
        if (safeMissing.length === 0) {
            return {
                response_text: null,
                thought_process: `SOCIAL_FALLBACK: Profile complete, handing over to bypass silently.`,
                reaction: null,
                extracted_data: extracted,
                close_conversation: true,
                recovery_active: false
            };
        }

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
            // Use freshly extracted data if available, fallback to existing DB candidateName
            const currentName = extracted.nombreReal || candidateName || '';
            const nameWords = currentName.trim().split(/\s+/).filter(w => w.length > 0).length;
            const firstName = nameWords > 0 ? currentName.trim().split(/\s+/)[0] : null;

            // Smart Logic: If we already have a full name (>= 2 words), forcefully remove 'apellidos' and 'nombre completo' from the missing list
            // so we don't redundantly ask for it if the profile is still incomplete for other reasons.
            let activeMissing = [...safeMissing];
            if (nameWords >= 2) {
                activeMissing = activeMissing.filter(f => !f.toLowerCase().includes('apellido') && !f.toLowerCase().includes('nombre completo'));
            }
            const actualFirstMissing = activeMissing.length > 0 ? activeMissing[0] : 'datos';

            // Only ask for surnames if we *only* have a first name (1 word) AND the user didn't just give us the surname.
            if ((actualFirstMissing === 'Apellidos' || (actualFirstMissing === 'Nombre completo' && nameWords === 1)) && nameWords < 2) {
                const namePart = firstName ? `, ${firstName}` : '';
                const templates = [
                    `¡Excelente${namePart}! ✨ Ya tengo tu nombre. ¿Me podrías proporcionar tus apellidos para continuar con tu registro? 🌸`,
                    `¡Mucho gusto${namePart}! 💖 Solo me faltan tus apellidos para que ya quedes en nuestro sistema. 🤭 ¿Me los pasas? ✨`,
                    `¡Qué bonito nombre${namePart}! 🌟 ¿Podrías decirme tus apellidos? Es para seguir con el proceso. 😉✨`,
                    `¡Perfecto${namePart}! ✨ Para avanzar, ¿cuáles son tus apellidos? 🌸`
                ];
                recoveryText = templates[Math.floor(Math.random() * templates.length)];
            } else if (reason === 'FALLBACK_REPETITION' || reason === 'FALLBACK_IDENTITY_REPETITION') {
                const variationTemplates = [
                    `${firstName ? firstName + ', d' : 'D'}ime, ¿me puedes pasar tu ${actualFirstMissing}? Es para tu registro. ✨`,
                    `Para seguir, ¿cuál es tu ${actualFirstMissing}? 😉🌸`,
                    `${firstName ? firstName + ', c' : 'C'}uéntame sobre tu ${actualFirstMissing}, ¡me falta ese dato! ✨`,
                    `¡Ok! ✨ Pero me falta confirmar tu ${actualFirstMissing}. 🌸 ¿Me lo dices?`
                ];
                recoveryText = variationTemplates[Math.floor(Math.random() * templates.length)];
            } else {
                const missingKey = actualFirstMissing.toLowerCase().trim();
                const isDate = missingKey.includes('fecha') || missingKey === 'fechanacimiento';
                // isNames is strictly for 1 word names now, handled above mostly, but kept for fallback logic
                const isNames = missingKey.includes('apellidos') || missingKey === 'apellidos' || (missingKey === 'nombre completo' && nameWords === 1);
                const isCategory = missingKey.includes('categor') || missingKey === 'categoria';


                const connector = isNames ? 'tus' : 'tu';
                const maybeExample = isDate ? ' (ej: 19/05/1990)' : '';

                const templates = [
                    `¡Excelente! ✨ ${firstName ? firstName + ', p' : 'P'}ara avanzar con tu registro, ¿me podrías proporcionar ${connector} ${firstMissing}${maybeExample}? 😉🌸`,
                    `${firstName ? '¡' + firstName + '! ✨ ' : ''}Me hace falta saber ${connector} ${firstMissing}${maybeExample} para tener tu perfil listo. 🤭 ¿Me ayudas con eso? ✨`,
                    `¡Casi lo tenemos! 💖 ${firstName ? firstName + ', n' : 'N'}ecesito el dato de ${connector} ${firstMissing}${maybeExample} para encontrarte la mejor vacante hoy mismo. 😉✨`,
                    `¿Me podrías decir ${connector} ${firstMissing}${maybeExample}? ✨ Es un paso importante para el proceso. 🌸`,
                    `¡Qué alegría! 🌟 Para que ya quedes en nuestro sistema, dime ${connector} ${firstMissing}${maybeExample}. 🤭✨`,
                    `¡Vas excelente! ✨ ${firstName ? firstName + ', d' : 'D'}ime ${connector} ${firstMissing}${maybeExample} para decirte qué vacantes tenemos disponibles. 🌸`,
                    `Oye, ${firstName || 'un detalle'}, ¿cuál es ${connector} ${firstMissing}${maybeExample}? ✨ Me sirve mucho para tu registro. 😉`,
                    `¡Perfecto! 💖 Ya casi acabamos. ¿Me pasas ${connector} ${firstMissing}${maybeExample}? ✨🌸`
                ];
                recoveryText = templates[Math.floor(Math.random() * templates.length)];

                // 🎡 [SPECIAL CATEGORY RECOVERY]: If missing field is Category, force the list injection
                if (isCategory) {
                    const singleSpacedCats = (categoriesList || '[Error: No hay categorías]').replace(/\n\n/g, '\n');
                    const isComplimentCtx = lastInput && /hermosa|guapa|linda|bella|preciosa|chula|hermoso|guapo|novio|salir conmigo|casamos/i.test(lastInput.toLowerCase());
                    const categoryMsg = isComplimentCtx
                        ? `¡Ay, qué cosas preguntas! 🤭✨ ... Pero primero, ayúdame a completar tu perfil para buscar el mejor empleo para ti:\n${singleSpacedCats}\n¿Cuál eliges? 🤭✨`
                        : `Para que ya quedes en nuestro sistema, mira estas son las opciones que tengo para ti 💖:\n${singleSpacedCats}\n¿Cuál eliges? 🤭✨`;
                    recoveryText = categoryMsg;
                }

                // 🎓 [SPECIAL ESCOLARIDAD RECOVERY]: If missing field is Escolaridad, show emoji list
                const isEscolaridad = missingKey.includes('escolaridad');
                if (isEscolaridad) {
                    recoveryText = `¡Súper! ✨ Ya casi termino tu perfil. ¿Me podrías indicar cuál es tu grado máximo de estudios? 🎓\n\n🎒 Primaria\n🏫 Secundaria\n🎓 Preparatoria\n📚 Licenciatura\n🛠️ Técnica\n🧠 Posgrado`;
                }
            }
        }

        const isCompliment = lastInput && /hermosa|guapa|linda|bella|preciosa|chula|hermoso|guapo|novio|salir conmigo|casamos/i.test(lastInput.toLowerCase());
        const complimentResponse = (isCompliment && !recoveryText.includes('qué cosas preguntas')) ? "¡Ay, qué lindo! 🤭✨ me chiveas... " : "";

        // 🛡️ [INQUIRY RECOVERY]: If user asks about job details but guard forces a fallback, prepend explanation
        const isJobInquiry = lastInput && /(?:[?¿]|\b)(d[oó]nde|cu[aá]ndo|cu[aá]nto|qu[eé]|c[oó]mo|hay|tienen|pagan|trabajo|vacantes|entrevistas?|sueldo|salario|pago|horario|ubicaci[oó]n|requisitos?)\b/i.test(lastInput.toLowerCase());
        let inquiryResponse = "";
        if (isJobInquiry && !isCompliment) {
            inquiryResponse = "¡Claro! 😊 Para darte información exacta sobre vacantes o entrevistas, primero necesito completar tu registro.\n\n";
            // Strip random joyous templates that don't match the tone of answering a question
            recoveryText = recoveryText.replace(/^.*?(¿Me podrías|Para avanzar|Para que ya|Me hace falta|Dime|necesito el dato|Cuál es).*/i, '$1');
            recoveryText = recoveryText.charAt(0).toUpperCase() + recoveryText.slice(1);
        }

        const greetingEmojis = ["👋", "✨", "🌸", "😊", "😇", "💖", "🌟"];
        const gEmoji = greetingEmojis[Math.floor(Math.random() * greetingEmojis.length)];
        const greetingReturn = lastInput && /hola|buen(as)? (dia|tarde|noche)|que tal/i.test(lastInput.toLowerCase()) ? `¡Hola! ${gEmoji} ` : "";
        return {
            response_text: `${greetingReturn}${inquiryResponse}${complimentResponse}${recoveryText}`,
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
