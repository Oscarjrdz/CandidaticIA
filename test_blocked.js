import { getRedisClient } from './api/utils/storage.js';
async function run() {
    const r = getRedisClient();
    const candId = await r.get('phone:5218116038195');
    if (!candId) { console.log('No phone mapping'); process.exit(0); }
    const candStr = await r.get(`candidate:${candId}`);
    if (candStr) {
        const c = JSON.parse(candStr);
        console.log("Blocked:", c.blocked);
    }
    process.exit(0);
}
run();
