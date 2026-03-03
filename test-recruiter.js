import { processMessage } from './api/ai/agent.js';
import { getRedisClient } from './api/utils/storage.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    try {
        const redis = getRedisClient();
        const candKeys = await redis.keys('candidate:*');
        if (candKeys.length === 0) {
            console.log("No candidates found.");
            process.exit(1);
        }

        // Find a candidate who is in a project (projectId != null)
        let targetCandId = null;
        for (let key of candKeys.slice(0, 50)) {
            const dataStr = await redis.get(key);
            if (dataStr) {
                const data = JSON.parse(dataStr);
                if (data.projectId) {
                    targetCandId = key.replace('candidate:', '');
                    break;
                }
            }
        }

        if (!targetCandId) {
            console.log("No candidate in a project found. Using first one.");
            targetCandId = candKeys[0].replace('candidate:', '');
        }

        console.log(`Testing with candidate: ${targetCandId}`);
        console.log("Calling processMessage with a question...");
        const result = await processMessage(targetCandId, '¿y dan vales de despensa?');
        console.log("Final ResponseTextVal:", result);
    } catch (e) {
        console.error("Error thrown:", e);
    }
    process.exit(0);
}

run();
