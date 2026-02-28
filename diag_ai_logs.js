import dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const redis = getRedisClient();
    const phone = "5218116038195"; // assuming it was stored as standard
    const keys = await redis.keys(`*${phone}*`);
    console.log("Keys matching phone:", keys);
    process.exit(0);
}
run();
