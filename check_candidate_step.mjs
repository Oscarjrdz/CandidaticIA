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
    const projRaw = await redis.get('project:proj_1771225156891_10ez5k');
    const proj = JSON.parse(projRaw);
    const steps = proj.steps.map(s => ({ id: s.id, name: s.name, hasCalendar: !!(s.calendarOptions?.length) }));
    console.log('PROJECT STEPS:', JSON.stringify(steps, null, 2));

    const candRaw = await redis.get('candidate:cand_1772943628116_3pmubhveo');
    const cand = JSON.parse(candRaw);
    console.log('CANDIDATE stepId:', cand.stepId);

    const metaRaw = await redis.hget('project:cand_meta:proj_1771225156891_10ez5k', 'cand_1772943628116_3pmubhveo');
    const meta = JSON.parse(metaRaw);
    console.log('META stepId:', meta.stepId);

    await redis.quit();
}
run().catch(console.error);
