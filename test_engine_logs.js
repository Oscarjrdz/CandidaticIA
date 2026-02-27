import { getRedisClient } from './api/utils/storage.js';
import dotenv from 'dotenv';
dotenv.config();

async function traceTelemetry() {
    const redis = getRedisClient();
    if (!redis) {
        console.log('Redis still null');
        return;
    }

    try {
        const cands = await redis.smembers('candidates:list:all');
        const c = cands[cands.length - 1];

        console.log(`Using Last Candidate: ${c}`);

        // Try reading raw recent logs if stored somewhere? 
        // Oh wait, `logs` array in `runAIAutomations` is returned to the caller but IS NOT saved to Redis. 
        // AI Telemetry only saves INFERENCE events, not pipeline logs.

        // Let's manually trigger the pipeline for this candidate and catch the logs directly!
        console.log("Triggering explicit test pipeline run...");
        const candData = await redis.get(`candidate:${c}`);
        if (candData) {
            const p = JSON.parse(candData);
            const targetProjectId = p.projectId;
            const targetStepId = p.stepId;

            if (!targetProjectId || !targetStepId) {
                console.log("Candidate missing project/step info.");
                return;
            }

            console.log(`Firing Engine for Project: ${targetProjectId}, Step: ${targetStepId}, Cand: ${c}`);

            const { runAIAutomations } = await import('./api/utils/automation-engine.js');
            const result = await runAIAutomations(true, {
                projectId: targetProjectId,
                stepId: targetStepId,
                targetCandidateId: c
            });

            console.log("\n--- ENGINE TRACE LOGS ---");
            result.logs?.forEach(l => console.log(l));
        }
    } catch (e) {
        console.error("Test execution failed:", e);
    }
    process.exit(0);
}

traceTelemetry();
