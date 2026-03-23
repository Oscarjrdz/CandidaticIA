import { processMessage } from './api/ai/agent.js';
import { getCandidateByPhone } from './api/utils/storage.js';

async function testLocally() {
    process.env.DEBUG_MODE = 'true';
    console.log("Starting test...");
    
    let target = await getCandidateByPhone('5218116038195@c.us');
    if(!target) target = await getCandidateByPhone('5218116038195');
    if(!target) target = await getCandidateByPhone('+5218116038195');
    
    if(!target) { console.log('not found'); return process.exit(1); }
    console.log("Candidate found:", target.id);
    
    try {
        await processMessage(target.id, 'lunes', null);
        console.log("Process complete!");
    } catch(e) {
        console.error("Crash during processMessage:", e);
    }
    process.exit(0);
}
testLocally();
