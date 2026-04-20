/**
 * 🛰️ ORCHESTRATOR (State Machine Brain)
 * Manages the high-level logic of moving candidates between Brenda and Projects.
 */
import {
    updateCandidate,
    addCandidateToProject,
    getProjectById,
    getRedisClient,
    saveMessage,
    getProjects,
    getActiveBypassRules
} from './storage.js';
import { runAIAutomations } from './automation-engine.js';
import { MediaEngine } from './media-engine.js';
import { sendUltraMsgMessage } from '../whatsapp/utils.js';

export class Orchestrator {
    /**
     * Determines if a candidate is ready to bypass Brenda and enter a project.
     * GLOBAL BEST PRACTICE: Re-evaluate on every 'COMPLETO' event.
     */
    static async checkBypass(candidateData, audit, isEnabled = true) {
        const isProfileComplete = audit.paso1Status === 'COMPLETO';
        const hasBeenCongratulated = !!(candidateData.congratulated === true || candidateData.congratulated === 'true');
        const alreadyInProject = !!(candidateData.projectId || candidateData.projectMetadata?.projectId);

        console.log(`[ORCHESTRATOR] 🧐 Checking Bypass for ${candidateData.id}:`, {
            isEnabled,
            isProfileComplete,
            hasBeenCongratulated,
            alreadyInProject
        });

        if (!isEnabled) return false;

        if (isProfileComplete && !hasBeenCongratulated && !alreadyInProject) {
            return true;
        }
        return false;
    }

    static async findMatchingProject(candidateData, excludeProjectIds = []) {
        const trace = [];
        const logTrace = (m) => {
            console.log(m);
            trace.push(`[${new Date().toISOString()}] ${m}`);
        };

        const redis = getRedisClient();
        const projects = await getProjects();
        const rules = await getActiveBypassRules();
        
        let targetProjectId = null;
        let matchedRuleName = null;

        for (const rule of rules) {
            logTrace(`   🔍 Evaluating Rule: ${rule.name}`);
            if (excludeProjectIds.includes(rule.projectId)) continue;

            if (rule.excludedTags && rule.excludedTags.length > 0 && candidateData.tags && Array.isArray(candidateData.tags)) {
                if (candidateData.tags.some(tag => rule.excludedTags.includes(tag))) {
                    logTrace(`   ❌ Skipped: Empleado contiene etiqueta excluida.`);
                    continue;
                }
            }

            const cAge = parseInt(candidateData.edad);
            if (!isNaN(cAge)) {
                if (rule.minAge && cAge < parseInt(rule.minAge)) continue;
                if (rule.maxAge && cAge > parseInt(rule.maxAge)) continue;
            }

            const cGender = (candidateData.genero || '').toLowerCase();
            const rGender = (rule.gender || 'Cualquiera').toLowerCase();
            if (rGender !== 'cualquiera' && cGender !== rGender) continue;

            const cCat = (candidateData.categoria || '').toLowerCase().trim();
            if (rule.categories && rule.categories.length > 0) {
                const isMatch = rule.categories.some(rc => {
                    const rCat = rc.toLowerCase().trim();
                    return rCat.includes(cCat) || cCat.includes(rCat);
                });
                if (!isMatch) continue;
            }

            const normalizeStr = (s) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const cMun = normalizeStr(candidateData.municipio);
            if (rule.municipios && rule.municipios.length > 0) {
                const isMatch = rule.municipios.some(rm => {
                    const rMun = normalizeStr(rm);
                    return rMun.includes(cMun) || cMun.includes(rMun);
                });
                if (!isMatch) continue;
            }

            const cEsc = normalizeStr(candidateData.escolaridad);
            if (rule.escolaridades && rule.escolaridades.length > 0) {
                const isMatch = rule.escolaridades.some(re => {
                    const rEsc = normalizeStr(re);
                    return rEsc.includes(cEsc) || cEsc.includes(rEsc);
                });
                if (!isMatch) continue;
            }

            targetProjectId = rule.projectId;
            matchedRuleName = rule.name;
            logTrace(`   ✅ PERFECT MATCH on Rule: ${rule.name} -> Project ${targetProjectId}`);
            break;
        }

        if (!targetProjectId) {
            targetProjectId = await redis?.get('bypass_selection');
            if (targetProjectId && targetProjectId !== 'null' && !excludeProjectIds.includes(targetProjectId)) {
                const selectedExists = projects.some(p => p.id === targetProjectId);
                if (selectedExists) matchedRuleName = 'Legacy Global Bypass';
                else targetProjectId = null;
            } else {
                targetProjectId = null;
            }
        }

        if (trace.length > 0 && redis) {
            try {
                await redis.lpush(`trace:handover:\${candidateData.id}`, ...trace.reverse());
                await redis.ltrim(`trace:handover:\${candidateData.id}`, 0, 19);
            } catch (e) {}
        }

        return { targetProjectId, matchedRuleName };
    }

    /**
     * Executes the Atomic Handover: move candidate + send congrats + start project.
     * Uses a Matching Engine to find the best project.
     */
    static async executeHandover(candidateData, config, msgId = null) {
        const candidateId = candidateData.id;
        const phone = candidateData.whatsapp;
        const candidateName = candidateData.nombreReal ? candidateData.nombreReal.split(' ')[0] : '';
        
        console.log(`🎯 Starting Premium Handover for \${candidateId}`);
        const redis = getRedisClient();
        const { targetProjectId, matchedRuleName } = await Orchestrator.findMatchingProject(candidateData, []);

        if (!targetProjectId) {
            console.log('❌ No matching project found for handover.');
            return false;
        }


        const project = await getProjectById(targetProjectId);
        if (!project || !project.steps || project.steps.length === 0) {
            console.log(`❌ Invalid project \${targetProjectId} for handover.`);
            return false;
        }

        const firstStep = project.steps[0];

        // Retrieve Vacancy — cache full object for instant send
        let currentVacancyName = '';
        let cachedVacancy = null;
        try {
            const { getVacancyById } = await import('./storage.js');
            const vId = Array.isArray(project.vacancyIds) && project.vacancyIds.length > 0 ? project.vacancyIds[0] : project.vacancyId;
            if (vId) {
                const v = await getVacancyById(vId);
                if (v) {
                    if (v.name) currentVacancyName = v.name;
                    cachedVacancy = v; // Full object reused below for instant vacancy send
                }
            }
        } catch (e) {
            console.error('[ORCHESTRATOR] Error fetching vacancy:', e.message);
        }

        // 2. ATOMIC TRANSACTION: State Migration
        // CRITICAL: candidateData here already has the MERGED extract (escolaridad, etc.)
        // from agent.js: executeHandover({ ...candidateData, ...candidateUpdates }, ...)
        // So we pass ALL of it to updateCandidate, not just the project fields.
        await updateCandidate(candidateId, {
            ...candidateData,                                         // Preserves escolaridad + all freshly extracted fields
            projectId: targetProjectId,
            stepId: firstStep.id,
            congrats_sent_at: new Date().toISOString(),
            congratulated: true,
            status: 'PROCESO',
            ...(currentVacancyName ? { currentVacancyName } : {})
        });

        await addCandidateToProject(targetProjectId, candidateId, {
            stepId: firstStep.id,
            origin: 'bot_handover',
            ...(currentVacancyName ? { currentVacancyName } : {})
        });

        // 3. ✨ PREMIUM MEDIA SEQUENCE (Strictly Sequential for correct WhatsApp delivery order)
        const introMsg = `¡OMG, ${candidateName}! 🤩 Acabo de revisar tu perfil y... ¡está PERFECTO! ✨🌸`;
        const inductionMsg = `Acabas de ser seleccionado para avanzar al proyecto de: *${project.name || 'Candidatic'}*. 🌟`;

        const { sendUltraMsgReaction } = await import('../whatsapp/utils.js');

        // 🎉 Reaction: fire non-blocking in background (does not affect message order)
        if (msgId) {
            sendUltraMsgReaction(config.instanceId, config.token, msgId, '🎉').catch(() => {});
        }

        // ✅ SEQUENTIAL SEND — guarantees WhatsApp delivery order: OMG → Seleccionado → Sticker
        // Parallel sends arrive in network-latency order which is non-deterministic on WhatsApp.
        await sendUltraMsgMessage(config.instanceId, config.token, phone, introMsg, 'chat');
        saveMessage(candidateId, { from: 'bot', content: introMsg, timestamp: new Date().toISOString() }).catch(() => {});

        await sendUltraMsgMessage(config.instanceId, config.token, phone, inductionMsg, 'chat');
        saveMessage(candidateId, { from: 'bot', content: inductionMsg, timestamp: new Date().toISOString() }).catch(() => {});

        // Sticker goes LAST — after both text bubbles are confirmed sent
        await MediaEngine.sendCongratsPack(config, phone, 'bot_celebration_sticker', candidateId);

        // 4. ⚡ INSTANT VACANCY SEND — Template-based, zero GPT, zero cold start.
        // The vacancy messageDescription is already fully formatted text. Calling GPT just to wrap it
        // added 10-30s of latency (HTTP round-trip to worker + Vercel cold start + GPT call).
        // Now we send it directly here in the same invocation: ~200ms total.
        let vacancyAlreadySent = false;
        try {
            const vacancyBody = cachedVacancy?.messageDescription || cachedVacancy?.description || '';
            if (vacancyBody) {
                const vacancyMsg = `¡Mira ${candidateName}! Te comparto la vacante que encontré para ti: ⏬\n\n${vacancyBody}`;
                const ctaMsg = `¿Te gustaría agendar una entrevista? 😊💖🌼`;

                await sendUltraMsgMessage(config.instanceId, config.token, phone, vacancyMsg, 'chat');
                saveMessage(candidateId, { from: 'bot', content: vacancyMsg, timestamp: new Date().toISOString() }).catch(() => {});

                await sendUltraMsgMessage(config.instanceId, config.token, phone, ctaMsg, 'chat');
                saveMessage(candidateId, { from: 'bot', content: ctaMsg, timestamp: new Date().toISOString() }).catch(() => {});

                vacancyAlreadySent = true;
                console.log(`⚡ [INSTANT] Vacancy sent directly (no GPT, no worker) for ${candidateId}`);
            }
        } catch (e) {
            console.error('[ORCHESTRATOR] Instant vacancy send failed, worker will retry:', e.message);
        }

        // 5. Background Worker — fires as failsafe if instant send failed, and handles multi-step pipeline logic.
        try {
            console.log(`⚙️ Triggering background worker for ${targetProjectId} (vacancyAlreadySent: ${vacancyAlreadySent})...`);
            const workerPayload = { targetProjectId, stepId: firstStep.id, candidateId, vacancyAlreadySent };
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://candidatic.com';

            // Fire and Forget (Do not await)
            fetch(`${apiUrl}/api/workers/run-automations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(workerPayload)
            }).catch(e => {
                console.error('[ORCHESTRATOR] Background Hook Failed (expected if timeout disconnected):', e.message);
            });

        } catch (e) {
            console.error('[ORCHESTRATOR] Worker trigger failed:', e.message);
        }

        // 📊 [X-RAY INTEGRATION]
        if (redis) {
            try {
                const xrayTrace = {
                    timestamp: new Date().toISOString(),
                    candidateId,
                    candidateData: {
                        nombreReal: candidateData.nombreReal,
                        edad: candidateData.edad,
                        municipio: candidateData.municipio,
                        categoria: candidateData.categoria,
                        escolaridad: candidateData.escolaridad,
                        genero: candidateData.genero
                    },
                    finalResult: 'MATCH',
                    projectMatched: project.name,
                    rules: [{ ruleName: matchedRuleName || 'Intelligent Matching Engine', isMatch: true, criteria: {}, checks: { age: true, municipio: true, categoria: true, escolaridad: true, genero: true } }]
                };
                await redis.lpush('debug:bypass:traces', JSON.stringify(xrayTrace));
                await redis.ltrim('debug:bypass:traces', 0, 49);
            } catch (e) {
                console.warn('[ORCHESTRATOR] X-Ray trace failed');
            }
        }

        console.log(`[ORCHESTRATOR] ✅ Handover Success!`);

        return {
            projectId: targetProjectId,
            stepId: firstStep.id,
            triggered: true
        };
    }

    /**
     * Manages step-to-step transitions within a project.
     */
    static async handleStepTransition(candidateId, projectId, nextStepId, config) {
        // Logic for moving within project steps
        await moveCandidateStep(projectId, candidateId, nextStepId);

        // Resolve bridge sticker
        const bridgeKey = await MediaEngine.resolveBridgeSticker('STEP_MOVE');
        if (bridgeKey) {
            const phone = (await import('./storage.js')).getCandidateById(candidateId).whatsapp;
            await MediaEngine.sendCongratsPack(config, phone, bridgeKey, candidateId);
        }
    }
}
