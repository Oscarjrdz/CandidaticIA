import dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const redis = getRedisClient();
    console.log("Deep scanning Redis for 8116038195...");
    let cursor = '0';
    const matches = [];
    do {
        const res = await redis.scan(cursor, 'MATCH', '*candidate*', 'COUNT', 1000);
        cursor = res[0];
        const keys = res[1];
        if (keys.length > 0) {
            const vals = await redis.mget(...keys);
            vals.forEach((v, i) => {
                if (v && v.includes("8116038195")) matches.push(keys[i]);
            });
        }
    } while (cursor !== '0');
    console.log("Matches:", matches);
    process.exit(0);
}

run();
