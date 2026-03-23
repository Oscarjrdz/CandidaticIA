import { getRedisClient, getCandidateByPhone } from './api/utils/storage.js';

async function t() {
    process.env.DEBUG_MODE = 'true';
    let target = await getCandidateByPhone('5218116038195@c.us');
    const r = getRedisClient();
    const h = await r.get('history:' + target.id);
    const ms = JSON.parse(h);
    console.log(ms.slice(-4));
    process.exit(0);
}
t();
