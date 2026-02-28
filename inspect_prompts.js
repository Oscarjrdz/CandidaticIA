import { getProjects } from './api/utils/storage.js';

async function inspectPrompts() {
    const projects = await getProjects();
    for (const p of projects) {
        if (p.name.includes("Ayudante") || p.name.includes("Aisin")) {
            console.log(`\n=== PROJECT: ${p.name} ===`);
            (p.steps || []).forEach(step => {
                if (step.aiConfig?.prompt) {
                    console.log(`\nSTEP: ${step.name}`);
                    console.log(`PROMPT:\n${step.aiConfig.prompt}`);
                }
            });
        }
    }
    process.exit(0);
}

inspectPrompts();
