import { getRedisClient } from './utils/storage.js';

async function main() {
    const redis = getRedisClient();
    if (!redis) { console.log("No redis"); return; }

    const id = "cand_1772199904667_sezoyp9ea";
    const tracesStr = await redis.lrange(`trace:handover:${id}`, 0, 20);
    console.log("HANDOVER TRACES:");
    tracesStr.reverse().forEach(t => console.log(t));

    const projId = await redis.get('bypass_selection');
    console.log("BYPASS SELECTION:", projId);

    // Check project steps
    const projectsStr = await redis.get('projects');
    if (projectsStr) {
        const projects = JSON.parse(projectsStr);
        const p = projects.find(p => p.id === projId || p.name === 'AYUDANTE AISIN');
        if (p) {
            console.log("PROJECT FOUND:", p.name, "Steps:", p.steps ? p.steps.length : 'none');
        } else {
            console.log("PROJECT NOT FOUND IN CACHE");
        }
    }

    process.exit(0);
}
main();
