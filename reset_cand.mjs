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
    const projId = 'proj_1771225156891_10ez5k';
    const candId = 'cand_1772943628116_3pmubhveo';
    const metaRaw = await redis.hget(`project:cand_meta:${projId}`, candId);
    if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        delete meta.citaFecha;
        delete meta.citaHora;
        await redis.hset(`project:cand_meta:${projId}`, candId, JSON.stringify(meta));
        console.log("Candidate meta reset successfully:", JSON.stringify(meta));
    } else {
        console.log("Meta not found", candId);
    }
    await redis.quit();
}
run().catch(console.error);
