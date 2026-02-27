import { getRedisClient } from './api/utils/storage.js';
import dotenv from 'dotenv';

dotenv.config();

async function traceAutomationFailure() {
    const redis = getRedisClient();
    try {
        const cands = await redis.smembers('candidates:list:all');
        const c = cands[cands.length - 1];
        if (!c) return;

        console.log(`Analyzing: ${c}`);

        // 1. Get Candidate Data
        const candData = await redis.get(`candidate:${c}`);
        if (!candData) return;

        const candidate = JSON.parse(candData);
        console.log(`Candidate Name: ${candidate.nombreReal || candidate.nombre}`);
        console.log(`Target Project: ${candidate.projectId}`);

        // 2. Get Project Data
        if (candidate.projectId) {
            const projData = await redis.get(`project:${candidate.projectId}`);
            if (projData) {
                const project = JSON.parse(projData);
                console.log(`Project Found: ${project.name}`);
                console.log(`Has Steps: ${project.steps?.length}`);

                const step1 = project.steps[0];
                console.log(`Step 1 ID: ${step1?.id}`);
                console.log(`Step 1 Enabled: ${step1?.aiConfig?.enabled}`);
                console.log(`Step 1 Prompt exists: ${!!step1?.aiConfig?.prompt}`);

                // 3. Are they actually in the project list?
                const isMember = await redis.sismember(`project:candidates:${candidate.projectId}`, c);
                console.log(`In Redis Project Set: ${isMember}`);

                // 4. Check Processed Lock
                const lockKey = `pipeline:${candidate.projectId}:${step1?.id}:${c}:processed`;
                const processed = await redis.get(lockKey);
                console.log(`Redis Processed Lock: ${processed}`);
            }
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

traceAutomationFailure();
