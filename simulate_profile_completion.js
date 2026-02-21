import { processMessage } from './api/ai/agent.js';
import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const redis = getRedisClient();
    // Use the candidate from before: cand_1771620713159_q1rcr0ngk
    const cid = 'cand_1771620713159_q1rcr0ngk';
    
    // Simulate user completing the last piece of data
    // To trigger completion, we need to artificially make their profile INCOMPLETO first
    const candStr = await redis.get(`candidatic:candidate:${cid}`);
    const cand = JSON.parse(candStr);
    
    // Set incomplete
    cand.escolaridad = null;
    cand.congratulated = false;
    cand.projectId = null;
    cand.stepId = null;
    await redis.set(`candidatic:candidate:${cid}`, JSON.stringify(cand));
    
    // Also clear from bypass index project mappings
    await redis.hdel('index:cand_project', cid);
    
    // Remove from all project candidate lists just in case
    const keys = await redis.keys('project:candidates:*');
    for (const key of keys) await redis.srem(key, cid);

    console.log('Sending final piece of data (Escolaridad = Licenciatura)...');
    try {
        const result = await processMessage(cid, 'Licenciatura');
        console.log('--- OUTPUT ---');
        console.log(result);
    } catch (e) {
        console.error('Error:', e);
    }
    process.exit(0);
}
run();
