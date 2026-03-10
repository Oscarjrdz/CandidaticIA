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
    let targetCand = null;
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', '*candidate:*', 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
            const vals = await redis.mget(...keys);
            for (let i = 0; i < vals.length; i++) {
                if (!vals[i]) continue;
                try {
                    const c = JSON.parse(vals[i]);
                    if (c.whatsapp && c.whatsapp.includes('5570072124')) {
                        // Avoid statuses, get root
                        if (keys[i].split(':').length === 2 && keys[i].startsWith('candidate:')) {
                            targetCand = c;
                            break;
                        }
                    }
                } catch (e) { }
            }
        }
    } while (cursor !== '0' && !targetCand);

    if (targetCand) {
        console.log('FOUND:', targetCand.id, 'Project:', targetCand.projectId, 'Step:', targetCand.stepId);

        if (targetCand.projectId) {
            const meta = await redis.hget(`project:cand_meta:${targetCand.projectId}`, targetCand.id);
            console.log('META:', meta);
        }
    } else {
        console.log('Target candidate not found!');
    }
    await redis.quit();
}
run().catch(console.error);
