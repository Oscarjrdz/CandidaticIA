/**
 * 🛰️ ORCHESTRATOR (State Machine Brain)
 * Manages the high-level logic of moving candidates between Brenda and Projects.
 */
import {
    updateCandidate,
    moveCandidateStep,
    getProjectById,
    getRedisClient,
    saveMessage
} from './storage.js';
import { MediaEngine } from './media-engine.js';
import { sendUltraMsgMessage } from '../whatsapp/utils.js';

export class Orchestrator {
    /**
     * Determines if a candidate is ready to bypass Brenda and enter a project.
     */
    static async checkBypass(candidateData, audit) {
        const isProfileComplete = audit.paso1Status === 'COMPLETO';
        const hasBeenCongratulated = candidateData.congratulated === true || candidateData.congratulated === 'true';
        const alreadyInProject = !!(candidateData.projectId || candidateData.projectMetadata?.projectId);

        if (isProfileComplete && !hasBeenCongratulated && !alreadyInProject) {
            return true;
        }
        return false;
    }

    /**
     * Executes the Atomic Handover: move candidate + send congrats + start project.
     */
    static async executeHandover(candidateData, config) {
        const candidateId = candidateData.id;
        const phone = candidateData.whatsapp;

        console.log(`[ORCHESTRATOR] 🎯 Executing Atomic Handover for ${candidateId}`);

        // 1. Resolve Project
        const redis = getRedisClient();
        const bypassProjectId = await redis?.get('bypass_selection'); // Global bypass project
        if (!bypassProjectId) {
            console.warn('[ORCHESTRATOR] ⚠️ No bypass project selected. Handover aborted.');
            return false;
        }

        const project = await getProjectById(bypassProjectId);
        if (!project || !project.steps || project.steps.length === 0) {
            console.warn('[ORCHESTRATOR] ⚠️ Invalid project for handover.');
            return false;
        }

        const firstStep = project.steps[0];

        // 2. ATOMIC TRANSACTION: State Update
        await updateCandidate(candidateId, {
            projectId: bypassProjectId,
            stepId: firstStep.id,
            congrats_sent_at: new Date().toISOString(),
            congratulated: true // State locking
        });

        await moveCandidateStep(bypassProjectId, candidateId, firstStep.id);

        // 3. MEDIA SEQUENCE: Congrats Message + Sticker
        const congratsMsg = "¡Felicidades! 🎉 Tu perfil está completo y has sido seleccionado para avanzar a la siguiente etapa. ✨🌸";
        await sendUltraMsgMessage(config.instanceId, config.token, phone, congratsMsg);
        await saveMessage(candidateId, { from: 'bot', content: congratsMsg, timestamp: new Date().toISOString() });

        // Sticker (Bridge)
        await MediaEngine.sendCongratsPack(config, phone);

        // 4. TRIGGER NEXT STEP (Chained AI)
        // Instead of calling recruiter-agent directly here (to avoid circular deps),
        // we return the new state so the agent can continue.
        return {
            projectId: bypassProjectId,
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
