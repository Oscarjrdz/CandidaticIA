import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();
        const candId = 'cand_1773154942716_gfc6mkqzp';
        const logs = await redis.lrange(`debug:agent:logs:${candId}`, 0, 15);

        console.log(`Found ${logs.length} trace logs for ${candId}.`);
        logs.forEach((logStr, i) => {
            const log = JSON.parse(logStr);
            console.log(`\n--- LOG ${i} ---`);
            console.log("USER:", log.receivedMessage);
            if (log.aiResult?.extracted_data) {
                console.log("EXTRACTED:", JSON.stringify(log.aiResult.extracted_data));
            }
        });
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
