import { getRedisClient } from './api/utils/storage.js';
async function run() {
    const r = getRedisClient();
    const l = await r.lrange('telemetry_logs_v4', 0, 100);
    const errs = l.filter(x => x.includes('FAIL') || x.includes('ERROR') || x.includes('Error') || x.includes('error'));
    console.log(errs);
    process.exit(0);
}
run();
