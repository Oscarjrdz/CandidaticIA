import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();

        // Find recent messages to get candidate id
        // Or grep recent trace keys
        const keys = await redis.keys('debug:agent:logs:*');

        let newestKey = null;
        let newestTime = 0;
        let candId = null;

        for (let key of keys) {
            const head = await redis.lrange(key, 0, 0);
            if (head && head.length > 0) {
                const parsed = JSON.parse(head[0]);
                const ts = new Date(parsed.timestamp).getTime();
                if (ts > newestTime) {
                    newestTime = ts;
                    newestKey = key;
                    candId = key.split(':').pop();
                }
            }
        }

        console.log(`Latest candidate: ${candId}`);

        console.log("\n=== CONVERSATION HISTORY ===");
        const msgs = await redis.lrange(`messages:${candId}`, 0, 15);
        msgs.reverse().forEach(m => {
            const parsed = JSON.parse(m);
            console.log(`[${parsed.from}] ${parsed.timestamp} : ${parsed.content.substring(0, 40)}`);
        });

        console.log("\n=== TRACE LOGS ===");
        const logs = await redis.lrange(newestKey, 0, 5);
        logs.forEach((log, idx) => {
            const parsed = JSON.parse(log);
            console.log(`\n=== LOG ${idx} ===`);
            console.log(`TIME: ${parsed.timestamp}`);
            console.log(`USER: ${parsed.receivedMessage}`);
            console.log(`AI_RESPONSE: ${parsed.aiResult?.response_text?.substring(0, 100)}`);
            console.log(`COMPLETE: ${parsed.isNowComplete}`);
            console.log(`EXTRACTED:`, JSON.stringify(parsed.aiResult?.extracted_data));
        });

        console.log("\n=== DB CANDIDATE ===");
        const c = await redis.get(`candidate:${candId}`);
        const parsedC = JSON.parse(c);
        console.log("Escolaridad:", parsedC.escolaridad);
        console.log("Categoria:", parsedC.categoria);
        console.log("Municipio:", parsedC.municipio);

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
