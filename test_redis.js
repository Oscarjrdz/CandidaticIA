import { getRedisClient } from './api/utils/storage.js';
async function run() {
    const r = getRedisClient();
    console.log(await r.get('ultramsg_config'));
    process.exit(0);
}
run();
