import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
process.env.DEBUG_MODE = 'true'; // Override silence
import { getRedisClient, unlockCandidate } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();
        const candId = 'cand_1773173224818_wp429qa09';

        // CLEAR LOCK AND WAITLIST TO GUARANTEE FRESH EXECUTION
        await unlockCandidate(candId);
        await redis.del(`waitlist:candidate:${candId}`);

        const cand = await redis.get(`candidate:${candId}`);
        const parsedC = JSON.parse(cand);
        // Force Escolaridad to null for test
        parsedC.escolaridad = null;
        await redis.set(`candidate:${candId}`, JSON.stringify(parsedC));

        console.log("=== STARTING DIRECT AGENT PORT SIMULATION ===");

        const rpushRes = await redis.rpush(`waitlist:candidate:${candId}`, JSON.stringify({
            id: 'sim_msg_' + Date.now(),
            text: 'Secu',
            timestamp: new Date().toISOString()
        }));

        console.log(`Pushed Secu to queue:. Length is now ${rpushRes}. Initiating runTurboEngine...`);

        // Add a 500ms delay to make sure Redis actually flushed
        await new Promise(resolve => setTimeout(resolve, 500));

        const { runTurboEngine } = await import('./api/workers/process-message.js');
        const result = await runTurboEngine(candId, 'user_sim');

        console.log("Turbo Result:", result);
        console.log("\n=== FINAL DB STATE AFTER 'SECU' ===");
        const candAfter = await redis.get(`candidate:${candId}`);
        const parsedCAfter = JSON.parse(candAfter);
        console.log("Escolaridad:", parsedCAfter.escolaridad);

    } catch (e) {
        console.error("FATAL CRASH:", e);
    }
    process.exit(0);
})();
