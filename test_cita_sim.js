import dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
process.env.DEBUG_MODE = 'true';
import { getRedisClient, unlockCandidate, getCandidateById, getMessages } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();
        const candId = 'cand_1773786504691_67bv0xxxq';

        // CLEAR LOCK AND WAITLIST
        await unlockCandidate(candId);
        await redis.del(`waitlist:candidate:${candId}`);
        await redis.del(`cita_pending:${candId}`);

        console.log('=== INJECTING SINGLE TEST MESSAGE: "opcion 5" ===\n');

        await redis.rpush(`waitlist:candidate:${candId}`, JSON.stringify({
            id: 'sim_msg_' + Date.now(),
            text: 'opcion 5',
            timestamp: new Date().toISOString()
        }));

        await new Promise(resolve => setTimeout(resolve, 500));

        const { runTurboEngine } = await import('./api/workers/process-message.js');
        const result = await runTurboEngine(candId, 'user_sim');

        console.log('\n=== ENGINE RESULT ===');
        console.log('Result:', JSON.stringify(result));

        // Check what was saved
        const candAfter = await getCandidateById(candId);
        console.log('\n=== AFTER STATE ===');
        console.log('citaFecha:', candAfter?.projectMetadata?.citaFecha || 'NOT SET');
        console.log('citaHora:', candAfter?.projectMetadata?.citaHora || 'NOT SET');

        const msgs = await getMessages(candId, 3);
        console.log('\n=== LAST 3 MESSAGES ===');
        for (const m of msgs) {
            const role = m.from === 'me' ? 'BOT' : 'USER';
            console.log(`[${role}] ${(m.content || '').substring(0, 250)}`);
        }

    } catch (e) {
        console.error('FATAL:', e);
    }
    process.exit(0);
})();
