import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });
import { getRedisClient } from './api/utils/storage.js';

(async () => {
    const redis = getRedisClient();
    try {
        console.log("--- WEBHOOK EVENTS ---");
        const events = await redis.lrange('webhook:events', 0, 5);
        events.forEach(e => {
            const parsed = JSON.parse(e);
            console.log(parsed.timestamp, parsed.from, parsed.content);
        });
        
        console.log("\n--- RECENT CANDIDATES ---");
        const recentCandsIds = await redis.zrevrange('candidates:list', 0, 4);
        for(const id of recentCandsIds) {
            const d = await redis.get(`candidate:${id}`);
            if(d) {
                const c = JSON.parse(d);
                console.log(c.id, c.whatsapp, c.nombre, c.ultimoMensaje);
            }
        }

        console.log("\n--- TRYING TO FIND 8116038195 ---");
        // Check exact match keys
        console.log('Phone Index 5218116038195 =>', await redis.hget('candidatic:phone_index', '5218116038195'));
        console.log('Admin State =>', await redis.get('admin_state:5218116038195'));
    } catch(e) { console.error(e) }
    process.exit(0);
})();
