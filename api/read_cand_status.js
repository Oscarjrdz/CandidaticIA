import { getRedisClient } from './utils/storage.js';

async function main() {
    const redis = getRedisClient();
    if(!redis) return;
    
    // Get candidate
    const id = "cand_1772199904667_sezoyp9ea";
    const candStr = await redis.hget('candidates', id);
    const cand = JSON.parse(candStr);
    console.log("CANDIDATE STATE:", {
       status: cand.status,
       projectId: cand.projectId,
       stepId: cand.stepId,
       congratulated: cand.congratulated
    });
    
    // Get last messages
    const msgsStr = await redis.lrange(`messages:${id}`, 0, 5);
    const msgs = msgsStr.map(m => JSON.parse(m));
    console.log("LAST MESSAGES:");
    msgs.reverse().forEach(m => console.log(`[${m.from}] ${m.content}`));
    
    process.exit(0);
}
main();
