import dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const redis = getRedisClient();
    const config = await redis.hgetall('configuracion:global');
    console.log("bot_ia_prompt:", config?.bot_ia_prompt);
    console.log("bot_ia_model:", config?.bot_ia_model);
    process.exit(0);
}
run();
