import { getRedisClient } from './utils/storage.js';

async function main() {
    const redis = getRedisClient();
    if (!redis) { console.log("No redis"); return; }

    // Check single project
    const projId = "proj_1771225156891_10ez5k";
    const projStr = await redis.get(`project:${projId}`);
    if (projStr) {
        const p = JSON.parse(projStr);
        console.log("PROJECT:", {
            id: p.id,
            name: p.name,
            steps: p.steps ? p.steps.length : 'MISSING',
            active: p.active
        });
    } else {
        console.log(`Project ${projId} not found in redis.`);
    }

    // Also check all projects just to see what's valid
    const allIds = await redis.zrange('projects:all', 0, -1);
    console.log("ALL PROJECTS:", allIds);

    process.exit(0);
}
main();
