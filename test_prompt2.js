import dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const redis = getRedisClient();
    const configKeys = [
        'bot_ia_prompt',
        'assistant_ia_prompt',
        'ai_config',
        'candidatic_categories',
        'bot_extraction_rules',
        'bot_cerebro1_rules',
        'bypass_enabled',
        'bot_ia_model'
    ];

    const values = await redis.mget(configKeys);
    console.log("Root Configs:");
    configKeys.forEach((key, i) => console.log(`${key}: ${values ? values[i] : null}`));
    process.exit(0);
}
run();
