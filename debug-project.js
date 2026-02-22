
import fs from 'fs';
import Redis from 'ioredis';

const test = async () => {
    try {
        const envContent = fs.readFileSync('.env.prod.local', 'utf8');
        const redisUrlMatch = envContent.match(/REDIS_URL="?([^"\n]+)/);
        if (!redisUrlMatch) {
            console.error("No REDIS_URL found");
            process.exit(1);
        }
        const redisUrl = redisUrlMatch[1];
        const client = new Redis(redisUrl, { tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined });

        const projectId = 'proj_1771225156891_10ez5k';
        const projectData = await client.get(`project:${projectId}`);
        if (!projectData) {
            console.log("Project not found");
            process.exit(0);
        }

        const project = JSON.parse(projectData);
        console.log(`PROJECT: ${project.name}`);
        project.steps.forEach((s, i) => {
            console.log(`\nSTEP ${i}: ${s.name} (ID: ${s.id})`);
            console.log(`Prompt: ${s.aiConfig?.prompt}`);
            console.log(`Enabled: ${s.aiConfig?.enabled}`);
        });

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};
test();
