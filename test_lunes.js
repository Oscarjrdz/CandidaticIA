import { processMessage } from './api/ai/agent.js';
import { getCandidateByPhone, getRedisClient } from './api/utils/storage.js';

async function testLocally() {
    process.env.DEBUG_MODE = 'true';
    let target = await getCandidateByPhone('5218116038195@c.us');
    const redis = getRedisClient();
    target.projectMetadata = { citaFecha: '2026-03-26' };
    await redis.set('candidate:'+target.id, JSON.stringify(target));
    console.log('Running test with citaFecha=2026-03-26 and input: y para el lunes');
    await processMessage(target.id, 'y para el lunes', null);
    process.exit(0);
}
testLocally();
