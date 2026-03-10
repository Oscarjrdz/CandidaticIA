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
    if (projRaw) {
        const p = JSON.parse(projRaw);
        const step = (p.steps || []).find(s => s.id === 'step_1771226980499');
        if (step) {
            console.log('STEP NAME:', step.name);
            console.log('STEP CALENDAR OPTIONS:', step.calendarOptions);
        } else {
            console.log("Step step_1771226980499 not found! Available steps:", p.steps.map(s => s.id));
        }
    } else {
        console.log("Proj not found");
    }
    await redis.quit();
}
run().catch(console.error);
