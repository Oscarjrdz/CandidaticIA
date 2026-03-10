import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();
        const candId = 'cand_1773154942716_gfc6mkqzp';

        console.log("\n=== CONVERSATION HISTORY ===");
        const msgs = await redis.lrange(`messages:${candId}`, 0, 50);
        msgs.forEach(m => {
            const parsed = JSON.parse(m);
            console.log(`[${parsed.from}] ${parsed.timestamp} : ${parsed.content.substring(0, 40)}`);
        });

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
