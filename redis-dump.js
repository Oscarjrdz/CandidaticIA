import { getRedisClient } from './api/utils/storage.js';

async function dump() {
    const redis = getRedisClient();
    if (!redis) {
        console.error("Redis not available");
        return;
    }

    const botPrompt = await redis.get('bot_ia_prompt');
    const assistantPrompt = await redis.get('assistant_ia_prompt');

    console.log("--- BOT IA PROMPT (Fase 1) ---");
    console.log(botPrompt);
    console.log("\n--- ASSISTANT IA PROMPT (Fase 2) ---");
    console.log(assistantPrompt);

    // Also check for projects
    const projectsKey = 'candidatic_projects';
    const projectsJson = await redis.get(projectsKey);
    if (projectsJson) {
        const projects = JSON.parse(projectsJson);
        projects.forEach(p => {
            console.log(`\n--- PROJECT: ${p.name} ---`);
            p.steps?.forEach(s => {
                if (s.aiConfig?.enabled) {
                    console.log(`Step: ${s.name} | Prompt: ${s.aiConfig.prompt}`);
                }
            });
        });
    }

    process.exit();
}

dump();
