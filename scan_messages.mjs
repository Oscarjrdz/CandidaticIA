import fs from 'fs';
import Redis from 'ioredis';

const envStr = fs.readFileSync('/tmp/.env.production', 'utf8');
const envMap = {};
envStr.split('\n').forEach(line => {
    const p = line.split('=');
    if (p.length > 1) envMap[p[0].trim()] = p.slice(1).join('=').trim().replace(/"/g, '');
});
const redis = new Redis(envMap['REDIS_URL']);

async function run() {
    let cursor = '0';
    let targetCandId = null;
    console.log("Scanning messages...");
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'messages:*', 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
            for (const key of keys) {
                const messagesRaw = await redis.lrange(key, -5, -1);
                for (const mRaw of messagesRaw) {
                    try {
                        const m = JSON.parse(mRaw);
                        const text = m.content || m.parts?.[0]?.text || '';
                        if (text.toLowerCase().includes('lunes 9 de marzo')) {
                            targetCandId = key.split(':')[1];
                            break;
                        }
                    } catch (e) { }
                }
                if (targetCandId) break;
            }
        }
    } while (cursor !== '0' && !targetCandId);

    if (targetCandId) {
        console.log('FOUND CANDIDATE ID:', targetCandId);

        const candRaw = await redis.get(`candidate:${targetCandId}`);
        if (candRaw) {
            const cand = JSON.parse(candRaw);
            console.log('CANDIDATE DATA:', { phone: cand.whatsapp, proj: cand.projectId, step: cand.stepId });

            if (cand.projectId) {
                const metaRaw = await redis.hget(`project:cand_meta:${cand.projectId}`, targetCandId);
                console.log('META DATA:', metaRaw);

                const projRaw = await redis.get(`project:${cand.projectId}`);
                if (projRaw) {
                    const p = JSON.parse(projRaw);
                    const step = (p.steps || []).find(s => s.id === cand.stepId);
                    if (step) {
                        console.log('CURRENT STEP CALENDAR OPTIONS:', step.calendarOptions);
                    }
                }
            }
        }
    } else {
        console.log('Target message not found!');
    }
    await redis.quit();
}
run().catch(console.error);
