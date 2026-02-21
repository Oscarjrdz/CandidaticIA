import { getMessages, getCandidateById } from '../utils/storage.js';

export default async function handler(req, res) {
    const phone = '5218116038195';
    const redis = (await import('../utils/storage.js')).getRedisClient();
    const cid = await redis.hget('candidatic:phone_index', phone);
    
    if (!cid) return res.status(404).send('No candidate');
    
    const cand = await getCandidateById(cid);
    const msgs = await getMessages(cid, 20);
    
    let out = `Candidate ${cand.nombreReal} (${cid}) | Project: ${cand.projectId || cand.projectMetadata?.projectId}\n\n`;
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        out += `[${m.timestamp}] ${String(m.from).toUpperCase()}: ${m.content}\n`;
    }
    
    res.status(200).send(out);
}
