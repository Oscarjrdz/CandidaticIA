import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();
        const candId = 'cand_1773154942716_gfc6mkqzp';

        const logs = await redis.lrange(`debug:agent:logs:${candId}`, 0, 49);
        console.log(`Found ${logs.length} trace logs total.`);

        logs.slice(0, 3).forEach((log, idx) => {
            const parsed = JSON.parse(log);
            console.log(`\n=== LOG ${idx} ===`);
            console.log(`TIME: ${parsed.timestamp}`);
            console.log(`USER: ${parsed.receivedMessage}`);
            console.log(`AI_RESPONSE: ${parsed.aiResult?.response_text?.substring(0, 100)}`);
            console.log(`COMPLETE: ${parsed.isNowComplete}`);
            console.log(`EXTRACTED:`, JSON.stringify(parsed.aiResult?.extracted_data));
        });

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
