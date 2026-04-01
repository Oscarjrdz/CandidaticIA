import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

(async () => {
    const redis = getRedisClient();
    try {
        const p1 = await redis.hget('candidatic:phone_index', '5218116038195');
        const p2 = await redis.hget('candidatic:phone_index', '8116038195');
        
        let candId = p1 || p2;
        if (!candId) {
            console.log('Not found in phone_index');
            // Try to scan looking for the ID.
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'candidate:*', 'COUNT', 100);
                cursor = nextCursor;
                if (keys.length > 0) {
                    const vals = await redis.mget(...keys);
                    for (let i = 0; i < vals.length; i++) {
                        if (vals[i] && vals[i].includes('8116038195')) {
                            candId = JSON.parse(vals[i]).id;
                            console.log('Found via scan: ', candId);
                            break;
                        }
                    }
                }
                if (candId) break;
            } while (cursor !== '0');
        }

        if (candId) {
            console.log('CANDIDATE ID: ', candId);
            const candRaw = await redis.get(`candidate:${candId}`);
            if (candRaw) {
                const cand = JSON.parse(candRaw);
                console.log('Last seen:', cand.ultimoMensaje);
                console.log('Is Locked?', await redis.get(`lock:candidate:${candId}`));
                const msgs = await redis.lrange(`messages:${cand.id}`, -5, -1);
                console.log('\n--- Messages ---');
                msgs.forEach(m => console.log(m));
                
                console.log('\n--- Queue ---');
                console.log(await redis.lrange(`agent:queue:${candId}`, 0, -1));
                
                console.log('\n--- Waitlist ---');
                console.log(await redis.lrange(`waitlist:candidate:${candId}`, 0, -1));
                
                console.log('\n--- Trace Logs ---');
                const trace = await redis.lrange(`debug:agent:logs:${candId}`, 0, 5);
                trace.forEach((log, idx) => {
                    const parsed = JSON.parse(log);
                    console.log(`[${idx}] TIME: ${parsed.timestamp} | USER: ${parsed.receivedMessage} | AI: ${parsed.aiResult?.response_text?.substring(0, 50)} | COMPLETE: ${parsed.isNowComplete}`);
                });
            }
        }
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
})();
