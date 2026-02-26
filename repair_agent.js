import fs from 'fs';
import path from 'path';

const filePath = path.resolve('api/ai/agent.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Remove the accidental catch block at 715 region
content = content.replace(/                }\n            } catch \(e\) \{\n                console\.error\('\[GEMINI BRAIN\] ❌ Runtime Error:', e\);\n                aiResult = AIGuard\.validate\(null, guardContext\);\n                responseTextVal = aiResult\?\.response_text;\n            }\n        \}/, '                }\n            }\n        }');

// 2. Fix the Gemini Brain block shadowing and try/catch
// This is the tricky part. I'll search for the block and replace it.
const geminiStart = '        // 3. CAPTURISTA BRAIN (GEMINI) - Only if not handled by others';
const reactionLogicStart = '        // --- REACTION LOGIC ---';

const startIndex = content.indexOf(geminiStart);
const endIndex = content.indexOf(reactionLogicStart);

if (startIndex !== -1 && endIndex !== -1) {
    const head = content.substring(0, startIndex);
    const tail = content.substring(endIndex);

    // We want to replace the block between startIndex and endIndex
    const replacement = `        // 3. CAPTURISTA BRAIN (GEMINI) - Only if not handled by others
        if (!isRecruiterMode && !isBridgeActive && !isHostMode) {
            try {
                // FORCE JSON SCHEMA FOR GEMINI
                systemInstruction += \`\\n[FORMATO OBLIGATORIO]: Responde SIEMPRE en JSON puro con este esquema:
{
  "response_text": "Texto para el usuario",
  "reaction": "Emoji o null",
  "extracted_data": { "nombreReal": "Valor", "genero": "Valor", ... },
  "thought_process": "Breve nota interna"
}\\n\`;

                if (isNewFlag && !botHasSpoken) {
                    systemInstruction += \`\\n[MISIÓN ACTUAL: BIENVENIDA]: Es el primer mensaje. Preséntate como la Lic. Brenda Rodríguez y pide el Nombre completo para iniciar el registro. ✨🌸\\n\`;
                } else if (!isProfileComplete) {
                    const cerebro1Rules = (batchConfig.bot_cerebro1_rules || DEFAULT_CEREBRO1_RULES)
                        .replace('{{faltantes}}', audit.missingLabels.join(', '))
                        .replace(/{{categorias}}/g, categoriesList);
                    systemInstruction += \`\\n\${cerebro1Rules}\\n\`;
                } else {
                    systemInstruction += !hasGratitude
                        ? \`\\n[MISIÓN ACTUAL: BUSCAR GRATITUD]: El perfil está completo. Sé súper amable y busca que el usuario te dé las gracias. ✨💅\\n\`
                        : \`\\n[MISIÓN ACTUAL: OPERACIÓN SILENCIO]: El usuario ya agradeció. No escribas texto. واکنش 👍 y close_conversation: true. 👋🤫\\n\`;
                }

                // [ANTI-REPETITION LAYER]
                const lastBotMsgsForPrompt = lastBotMessages.slice(-4);
                systemInstruction += \`\\n[MEMORIA RECIENTE]: \\n\${lastBotMsgsForPrompt.length > 0 ? lastBotMsgsForPrompt.map((m, i) => \`\${i + 1}. "\${m}"\`).join('\\n') : '(Primer contacto)'}\\n⚠️ Tu respuesta debe ser TOTALMENTE DIFERENTE a las anteriores.\\n\`;

                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.0-flash",
                    systemInstruction,
                    generationConfig: { responseMimeType: "application/json", temperature: 0.8 }
                });

                const chat = model.startChat({ history: recentHistory });
                const result = await chat.sendMessage(userParts);
                const textResult = result.response.text();
                console.log(\`[GEMINI RAW] 🤖:\`, textResult);

                // 🛡️ [AI GUARDRAIL]
                const rawJson = AIGuard.sanitizeJSON(textResult);
                const guardContext = {
                    isProfileComplete: audit.paso1Status === 'COMPLETO',
                    missingFields: audit.missingLabels,
                    lastInput: aggregatedText,
                    isNewFlag: isNewFlag && !botHasSpoken, // 🛡️ Hardened Loop Breaker
                    candidateName: getFirstName(realName) || realName, // Use first name for context
                    lastBotMessages: lastBotMessages
                };

                aiResult = AIGuard.validate(rawJson, guardContext);
                responseTextVal = aiResult.response_text;

                // 🧬 [DUAL-STREAM EXTRACTION & COALESCENCE]
                if (aiResult.extracted_data && Object.keys(aiResult.extracted_data).length > 0) {
                    console.log(\`[DUAL-STREAM] 🧬 Extracted:\`, aiResult.extracted_data);

                    // Zuckerberg-Level Coalescence Engine
                    if (aiResult.extracted_data.nombreReal) {
                        aiResult.extracted_data.nombreReal = coalesceName(candidateData.nombreReal, aiResult.extracted_data.nombreReal);
                    }
                    if (aiResult.extracted_data.fechaNacimiento) {
                        aiResult.extracted_data.fechaNacimiento = coalesceDate(candidateData.fechaNacimiento, aiResult.extracted_data.fechaNacimiento);
                    }

                    Object.assign(candidateUpdates, aiResult.extracted_data);
                }

                // 🔄 [TRANSITION & HANDOVER]
                const currentAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
                isNowComplete = currentAudit.paso1Status === 'COMPLETO';

                if (await Orchestrator.checkBypass(candidateData, currentAudit)) {
                    console.log(\`[ORCHESTRATOR] 🚀 Handover Triggered.\`);
                    const handoverResult = await Orchestrator.executeHandover({ ...candidateData, ...candidateUpdates }, config);
                    if (handoverResult?.triggered) {
                        candidateUpdates.projectId = handoverResult.projectId;
                        candidateUpdates.stepId = handoverResult.stepId;
                        responseTextVal = null; // Silence main stream, handover message already sent
                    }
                } else if (isNowComplete && !candidateData.congratulated) {
                    console.log(\`[ORCHESTRATOR] 🛋️ Entering Waiting Room.\`);
                    responseTextVal = "¡Listo! 🌟 Ya tengo todos tus datos guardados. Pronto un reclutador te contactará. ✨🌸";
                    candidateUpdates.congratulated = true;
                    await MediaEngine.sendCongratsPack(config, candidateData.whatsapp, 'bot_celebration_sticker');
                }
            } catch (e) {
                console.error('[GEMINI BRAIN] ❌ Runtime Error:', e);
                // Fallback context if loop crashed early
                const fallbackContext = {
                    isProfileComplete: audit?.paso1Status === 'COMPLETO',
                    missingFields: audit?.missingLabels || [],
                    isNewFlag: isNewFlag && !botHasSpoken,
                    candidateName: getFirstName(realName) || realName,
                    lastBotMessages: lastBotMessages
                };
                aiResult = AIGuard.validate(null, fallbackContext);
                responseTextVal = aiResult?.response_text;
            }
        }

`;
    fs.writeFileSync(filePath, head + replacement + tail);
    console.log('✅ Surgical repair of agent.js completed.');
} else {
    console.error('❌ Could not find search markers in agent.js');
}
