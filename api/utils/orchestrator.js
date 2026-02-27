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

    /**
     * Executes the Atomic Handover: move candidate + send congrats + start project.
     * Uses a Matching Engine to find the best project.
     */
    static async executeHandover(candidateData, config, msgId = null) {
        const candidateId = candidateData.id;
        const phone = candidateData.whatsapp;
        const candidateName = candidateData.nombreReal ? candidateData.nombreReal.split(' ')[0] : '';
        const trace = [];
        const logTrace = (m) => {
            console.log(m);
            trace.push(`[${new Date().toISOString()}] \${m}`);
        };

        logTrace(`🎯 Starting Premium Handover for \${candidateId}`);

        // 1. SMART MATCHING ENGINE (Silicon Valley Pattern)
        const redis = getRedisClient();
        const projects = await getProjects();
        const rules = await getActiveBypassRules();
        logTrace(`🧩 Found ${projects.length} active projects and ${rules.length} Bypass Rules for handover.`);

        let targetProjectId = null;
        let matchedRuleName = null;

        // NEW INTELLIGENT ROUTING LOGIC (Bypass Rules Evaluation)
        for (const rule of rules) {
            logTrace(`   🔍 Evaluating Rule: ${rule.name}`);

            // 1. Age Check
            const cAge = parseInt(candidateData.edad);
            if (!isNaN(cAge)) {
                if (rule.minAge && cAge < parseInt(rule.minAge)) continue; // Fails min age
                if (rule.maxAge && cAge > parseInt(rule.maxAge)) continue; // Fails max age
            }

            // 2. Gender Check
            const cGender = (candidateData.genero || '').toLowerCase();
            const rGender = (rule.gender || 'Cualquiera').toLowerCase();
            if (rGender !== 'cualquiera' && cGender !== rGender) continue;

            // 3. Category Check
            const cCat = (candidateData.categoria || '').toLowerCase().trim();
            if (rule.categories && rule.categories.length > 0) {
                const isMatch = rule.categories.some(rc => {
                    const rCat = rc.toLowerCase().trim();
                    return rCat.includes(cCat) || cCat.includes(rCat);
                });
                if (!isMatch) continue;
            }

            // 4. Municipio Check
            const normalizeStr = (s) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const cMun = normalizeStr(candidateData.municipio);
            if (rule.municipios && rule.municipios.length > 0) {
                const isMatch = rule.municipios.some(rm => {
                    const rMun = normalizeStr(rm);
                    return rMun.includes(cMun) || cMun.includes(rMun);
                });
                if (!isMatch) continue;
            }

            // 5. Escolaridad Check
            const cEsc = normalizeStr(candidateData.escolaridad);
            if (rule.escolaridades && rule.escolaridades.length > 0) {
                const isMatch = rule.escolaridades.some(re => {
                    const rEsc = normalizeStr(re);
                    return rEsc.includes(cEsc) || cEsc.includes(rEsc);
                });
                if (!isMatch) continue;
            }

            // MATCH FOUND
            targetProjectId = rule.projectId;
            matchedRuleName = rule.name;
            logTrace(`   ✅ PERFECT MATCH on Rule: ${rule.name} -> Project ${targetProjectId}`);
            break;
        }

        // FALLBACK: If no rules match, use legacy global bypass OR first project with vacancies 
        if (!targetProjectId) {
            logTrace(`⚠️ No Bypass Rules matched.`);

            // STRICT ENFORCEMENT: If bypass rules exist, and none matched, we MUST NOT fallback. 
            // The candidate goes to the waiting room.
            if (rules.length > 0) {
                logTrace(`🚫 Bypass rules exist but none matched. Candidate must go to waiting room.`);
            } else {
                logTrace(`Attempting Global Bypass Fallback since no explicit rules are defined...`);
                targetProjectId = await redis?.get('bypass_selection');
                if (targetProjectId && (targetProjectId.trim() === '' || targetProjectId === 'null')) targetProjectId = null;

                if (targetProjectId) {
                    const selectedExists = projects.some(p => p.id === targetProjectId);
                    if (!selectedExists) targetProjectId = null;
                    else matchedRuleName = 'Legacy Global Bypass';
                }

                if (!targetProjectId && projects.length > 0) {
                    logTrace(`🔍 Match based on FIRST available project...`);
                    const matchedProject = projects.find(p => {
                        const vacancyIds = p.vacancyIds || [];
                        const hasVacancies = Array.isArray(vacancyIds) && vacancyIds.length > 0;
                        return hasVacancies;
                    }) || projects[0];

                    targetProjectId = matchedProject?.id;
                    matchedRuleName = 'Fallback Default Project';
                    logTrace(`🏁 Fallback Result: ${targetProjectId} (${matchedProject?.name || 'Unknown'})`);
                }
            }
        }

        if (trace.length > 0 && redis) {
            try {
                await redis.lpush(`trace:handover:\${candidateId}`, ...trace.reverse());
                await redis.ltrim(`trace:handover:\${candidateId}`, 0, 19);
            } catch (e) {
                console.warn('[ORCHESTRATOR] Failed to save trace to Redis');
            }
        }

        if (!targetProjectId) {
            logTrace('❌ No matching project found for handover.');
            return false;
        }

        const project = await getProjectById(targetProjectId);
        if (!project || !project.steps || project.steps.length === 0) {
            logTrace(`❌ Invalid project \${targetProjectId} for handover.`);
            return false;
        }

        const firstStep = project.steps[0];

        // 2. ATOMIC TRANSACTION: State Migration
        await updateCandidate(candidateId, {
            projectId: targetProjectId,
            stepId: firstStep.id,
            congrats_sent_at: new Date().toISOString(),
            congratulated: true,
            status: 'PROCESO'
        });

        await addCandidateToProject(targetProjectId, candidateId, { stepId: firstStep.id, origin: 'bot_handover' });

        // 3. ✨ PREMIUM MEDIA SEQUENCE (Multi-Layered)

        // Phase 1: Immediate Reaction (Non-blocking for speed)
        const { sendUltraMsgReaction } = await import('../whatsapp/utils.js');
        if (msgId) {
            sendUltraMsgReaction(config.instanceId, config.token, msgId, '🎉').catch(() => { });
        }

        // Phase 2: Enthusiastic Announcement
        const introMsg = `¡OMG, ${candidateName}! 🤩 Acabo de revisar tu perfil y... ¡está PERFECTO! ✨🌸`;
        await sendUltraMsgMessage(config.instanceId, config.token, phone, introMsg, 'chat', { priority: 0 });
        await saveMessage(candidateId, { from: 'bot', content: introMsg, timestamp: new Date().toISOString() });

        // Phase 3: Tactical Pause (Typing simulated by delay)
        await new Promise(r => setTimeout(r, 1500));

        // Phase 4: Project Induction (Simplified Text)
        const inductionMsg = `Acabas de ser seleccionado para avanzar al proyecto de: *${project.name || 'Candidatic'}*. 🌟`;
        await sendUltraMsgMessage(config.instanceId, config.token, phone, inductionMsg, 'chat', { priority: 0 });
        await saveMessage(candidateId, { from: 'bot', content: inductionMsg, timestamp: new Date().toISOString() });

        // Phase 5: Bridge Sticker (Jim Carrey Celebration Enforced)
        await MediaEngine.sendCongratsPack(config, phone, 'bot_celebration_sticker');

        // Phase 6: Instant Automations Trigger (Send Vacancy Immediately)
        try {
            logTrace(`⚙️ Triggering real-time project automations for ${targetProjectId}...`);
            await runAIAutomations(true, { projectId: targetProjectId, stepId: firstStep.id, targetCandidateId: candidateId });

            // Failsafe: Si el motor de automatización falló por concurrencia u otro bloqueo interno,
            // garantizamos la entrega de la vacante disparando directamente el prompt configurado.
            const metaKey = `pipeline:${targetProjectId}:${firstStep.id}:${candidateId}:processed`;
            const isProcessed = await redis.get(metaKey);

            if (!isProcessed && firstStep.aiConfig?.prompt) {
                console.warn('[ORCHESTRATOR] ⚠️ Failsafe auto-trigger firing! Engine bypassed.');
                const { getVacancyById } = await import('./storage.js');
                const vId = Array.isArray(project.vacancyIds) && project.vacancyIds.length > 0 ? project.vacancyIds[0] : project.vacancyId;
                const v = await getVacancyById(vId);
                const vacCtx = {
                    name: v?.name || '',
                    messageDescription: v?.messageDescription || v?.description || '',
                    description: v?.description || '',
                    salary: v?.salary_range || 'N/A',
                    schedule: v?.schedule || 'N/A'
                };

                // SEND THE ACTUAL HUMAN MESSAGE, NOT THE RAW AI PROMPT
                let candidateFirstName = (candidateData.nombreReal || candidateData.nombre || 'Candidato').split(' ')[0];
                let p = `¡Mira ${candidateFirstName}! Te comparto la vacante que encontré para ti: ⏬\n\n${vacCtx.messageDescription}`;

                await sendUltraMsgMessage(config.instanceId, config.token, phone, p, 'chat', { priority: 0 });
                await redis.set(metaKey, 'true', 'EX', 3600 * 24 * 30);
                await saveMessage(candidateId, { from: 'bot', content: p, timestamp: new Date().toISOString(), meta: { pipelineStep: firstStep.id } });
            }
        } catch (e) {
            console.error('[ORCHESTRATOR] Auto-trigger failed:', e.message);
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
            await MediaEngine.sendCongratsPack(config, phone, bridgeKey);
        }
    }
}
