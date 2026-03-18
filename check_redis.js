import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getRedisClient } from './api/utils/storage.js';

async function run() {
    try {
        const redis = getRedisClient();
        if (!redis) {
            console.log("No redis!"); process.exit(1);
        }
        const keys = await redis.keys('debug:ultramsg:*');
        console.log("Found keys:", keys.length);
        for (const key of keys) {
            const val = await redis.get(key);
            console.log(key, val);
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();
