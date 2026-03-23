import { getRedisClient } from './api/utils/storage.js';
async function run() {
    const r = getRedisClient();
    const l = await r.lrange('telemetry_logs_v4', 0, 30); // get more
    for(const lg of l) {
        if(lg.includes('INGRESS')) {
            console.log(JSON.stringify(JSON.parse(lg), null, 2));
        }
    }
    process.exit(0);
}
run();
