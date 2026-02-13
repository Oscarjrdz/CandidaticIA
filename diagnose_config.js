import { getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    try {
        const aiConfig = await redis.get('ai_config');
        const iaActive = await redis.get('bot_ia_active');
        console.log('--- DIAGNOSTIC DUMP ---');
        console.log('bot_ia_active:', iaActive);
        console.log('ai_config:', JSON.stringify(JSON.parse(aiConfig), null, 2));
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

diagnose();
