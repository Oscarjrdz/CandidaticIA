import { getRedisClient } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();
        const raw = await redis.lrange('webhook_events_incoming', 0, 5);
        for (let r of raw) {
            const ev = JSON.parse(r);
            console.log("----- EVENTO WEBHOOK -----");
            console.log(JSON.stringify(ev.eventData, null, 2));
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
