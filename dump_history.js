import { getMessages, getCandidateById } from './api/utils/storage.js';

async function run() {
    // cand_1771618360662_q8g2u6m29 is the actual user from before 
    // Wait, let's find the candidate by phone
    const phone = '5218116038195';
    const redis = (await import('./api/utils/storage.js')).getRedisClient();
    const cid = await redis.hget('candidatic:phone_index', phone);

    if (!cid) {
        console.log('No candidate found for phone');
        process.exit(1);
    }

    const cand = await getCandidateById(cid);
    const msgs = await getMessages(cid, 20);

    console.log(`Candidate ${cand.nombreReal} (${cid}) | Project: ${cand.projectId || cand.projectMetadata?.projectId}`);
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        console.log(`[${m.timestamp}] ${String(m.from).toUpperCase()}: ${m.content}`);
    }
    process.exit(0);
}
run();
