import { getRedisClient, getCandidateByPhone } from './api/utils/storage.js';

// Search the latest candidates and check their `tieneEmpleo` and `projectMetadata` status.
async function debugCandidate() {
    const redis = getRedisClient();
    try {
        // Let's get the most recent candidates from the list
        const ids = await redis.smembers('candidates:list:all');
        if (ids.length === 0) {
            console.log("No candidates found.");
            return;
        }

        // Just fetch the last few
        for (let i = Math.max(0, ids.length - 5); i < ids.length; i++) {
            const raw = await redis.get(`candidate:${ids[i]}`);
            if (raw) {
                const c = JSON.parse(raw);
                console.log(`\n===================`);
                console.log(`Candidate: ${c.nombreReal || c.nombre}`);
                console.log(`Phone: ${c.whatsapp}`);
                console.log(`tieneEmpleo: "${c.tieneEmpleo}"`);
                console.log(`empleo: "${c.empleo}"`);
                console.log(`status: "${c.status}"`);
                console.log(`projectId: "${c.projectId}"`);
                console.log(`stepId: "${c.stepId}"`);
            }
        }

        console.log(`\nChecking AI config...`);
        const configRaw = await redis.get('ai_config');
        if (configRaw) {
            const cfg = JSON.parse(configRaw);
            console.log(`Gemini Key Configured: ${!!cfg.geminiApiKey}`);
            console.log(`OpenAI Key Configured: ${!!cfg.openaiApiKey}`);
        }
        console.log(`Bot Active: ${await redis.get('bot_ia_active')}`);

    } catch (e) {
        console.error("Error connecting to Redis:", e);
    }
    process.exit(0);
}

debugCandidate();
