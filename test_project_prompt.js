import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient, getProjectById } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();
        const candId = 'cand_1773156607009_e91b8yju3';
        const cand = await redis.get(`candidate:${candId}`);
        const parsedC = JSON.parse(cand);

        const proj = await getProjectById(parsedC.projectId);
        console.log("PROJECT PROMPT:", proj.steps[0].aiConfig.prompt);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
