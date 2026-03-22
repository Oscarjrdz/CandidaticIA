import { getRedisClient } from './api/utils/storage.js';
async function run() {
    const r = getRedisClient();
    const msgs = await r.lrange('messages:cand_1774216708251_g6avo3ez7', 0, -1);
    console.log("MESSAGES FOR CITA:", msgs.map(m => m.substring(0, 100)));
    
    // Check if the Cita step message was generated
    const trace = await r.lrange('debug:agent:logs:cand_1774216708251_g6avo3ez7', 0, -1);
    if(trace && trace.length > 0) {
        console.log("TRACE:", JSON.parse(trace[0]).aiResult);
    }
    process.exit(0);
}
run();
