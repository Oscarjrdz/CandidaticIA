import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);
async function run() {
    const list = await redis.zrevrange('bot_candidates_list', 0, 100);
    let cid = null;
    for (const id of list) {
        const cStr = await redis.get('candidate:' + id);
        if (cStr && JSON.parse(cStr).whatsapp.includes('8116038195')) {
            console.log('Candidate found:', id);
            cid = 'cand_' + id;
            break; // take latest
        }
    }
    if (!cid) { console.log('not found in last 100'); process.exit(1); }

    const logs = await redis.lrange('debug:agent:logs:' + cid, 0, 5);
    for (const l of logs) {
        const parsed = JSON.parse(l);
        console.log('USER:', parsed.receivedMessage);
        const ai = parsed.aiResult;
        console.log('AI RESPONSE TEXT:', ai?.response_text);
        console.log('AI THOUGHT:', ai?.thought_process);
        console.log('INTENT:', parsed.intent);
        console.log('------');
    }
    process.exit(0);
}
run();
