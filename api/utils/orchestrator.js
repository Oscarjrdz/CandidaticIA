/**
 * 🛰️ ORCHESTRATOR (State Machine Brain)
 * Manages the high-level logic of moving candidates between Brenda and Projects.
 */
import {
    updateCandidate,
    moveCandidateStep,
    getProjectById,
    getRedisClient,
    saveMessage,
    getProjects
} from './storage.js';
import { MediaEngine } from './media-engine.js';
import { sendUltraMsgMessage } from '../whatsapp/utils.js';

export class Orchestrator {
    /**
     * Determines if a candidate is ready to bypass Brenda and enter a project.
     */
    /**
     * Determines if a candidate is ready to bypass Brenda and enter a project.
     * GLOBAL BEST PRACTICE: Re-evaluate on every 'COMPLETO' event.
     */
    static async checkBypass(candidateData, audit, isEnabled = true) {
        if (!isEnabled) return false;

        const isProfileComplete = audit.paso1Status === 'COMPLETO';
        const hasBeenCongratulated = !!(candidateData.congratulated === true || candidateData.congratulated === 'true');

        // 🛡️ [PROJECT ISOLATION]: If candidate already belongs to a project, 
        // they should follow their own flow and NOT be hijacked by the bypass engine.
        const alreadyInProject = !!(candidateData.projectId || candidateData.projectMetadata?.projectId);

        // Zuckerberg Level: Even if in a project, if they haven't been congratulated 
        // as "Complete", we might want to trigger the handover logic.
        if (isProfileComplete && !hasBeenCongratulated && !alreadyInProject) {
            return true;
        }
        return false;
    }

    /**
     * Executes the Atomic Handover: move candidate + send congrats + start project.
     * Uses a Matching Engine to find the best project.
     */
    static async executeHandover(candidateData, config) {
        const candidateId = candidateData.id;
        const phone = candidateData.whatsapp;

        console.log(`[ORCHESTRATOR] 🎯 Executing Intelligent Handover for ${candidateId}`);

        // 1. SMART MATCHING ENGINE (Silicon Valley Pattern)
        const redis = getRedisClient();
        const projects = await getProjects();

        // Priority 1: Specifically selected bypass project
        let targetProjectId = await redis?.get('bypass_selection');

        // Validation: Ensure the selected bypass project actually exists
        if (targetProjectId) {
            const selectedExists = projects.some(p => p.id === targetProjectId);
            if (!selectedExists) {
                console.warn(`[ORCHESTRATOR] ⚠️ Bypass project ${targetProjectId} not found in active list. Falling back...`);
                targetProjectId = null;
            }
        }

        // Priority 2: Match based on Municipality/Category or first active project
        if (!targetProjectId && projects.length > 0) {
            console.log(`[ORCHESTRATOR] 🧩 Matching logic triggered for ${projects.length} projects...`);
            const matchedProject = projects.find(p => {
                const vacancyIds = p.vacancyIds || [];
                // Silicon Valley Pattern: Link to the first project that has active vacancies
                return vacancyIds.length > 0;
            }) || projects[0]; // Final fallback: first project in list

            targetProjectId = matchedProject?.id;
        }

        if (!targetProjectId) {
            console.warn('[ORCHESTRATOR] ⚠️ No matching project found for handover.');
            return false;
        }

        const project = await getProjectById(targetProjectId);
        if (!project || !project.steps || project.steps.length === 0) {
            console.warn(`[ORCHESTRATOR] ⚠️ Invalid project ${targetProjectId} for handover.`);
            return false;
        }

        const firstStep = project.steps[0];

        // 2. ATOMIC TRANSACTION: State Migration
        await updateCandidate(candidateId, {
            projectId: targetProjectId,
            stepId: firstStep.id,
            congrats_sent_at: new Date().toISOString(),
            congratulated: true,
            status: 'PROCESO' // Enterprise status update
        });

        await moveCandidateStep(targetProjectId, candidateId, firstStep.id);

        // 3. MEDIA SEQUENCE: Congrats Message + Bridge Sticker (Jim Carrey style)
        const congratsMsg = `¡Felicidades! 🎉 Tu perfil está 100% completo y has sido seleccionado para avanzar. ✨🌸\n\nEstoy muy emocionada de decirte que ya entraste a nuestro proceso oficial para la vacante de ${project.name || 'Candidatic'}.`;

        await sendUltraMsgMessage(config.instanceId, config.token, phone, congratsMsg);
        await saveMessage(candidateId, { from: 'bot', content: congratsMsg, timestamp: new Date().toISOString() });

        // 🌉 THE "JIM CARREY" BRIDGE STICKER
        // We look for 'bot_step_move_sticker' or 'bot_bridge_standard'
        const bridgeKey = await MediaEngine.resolveBridgeSticker('STEP_MOVE');
        await MediaEngine.sendCongratsPack(config, phone, bridgeKey || 'bot_step_move_sticker');

        console.log(`[ORCHESTRATOR] ✅ Handover Success: Candidate ${candidateId} -> ${project.name}`);

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
