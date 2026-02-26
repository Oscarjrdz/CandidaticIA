import { getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('❌ Redis not available');
        return;
    }

    const isActive = await redis.get('bot_ia_active');
    const prompt = await redis.get('bot_ia_prompt');
    const aiConfig = await redis.get('ai_config');
    const model = await redis.get('bot_ia_model');

    console.log('--- BOT IA DIAGNOSTIC ---');
    console.log(`Master Bot Active: ${isActive}`);
    console.log(`Prompt Configured: ${prompt ? '✅' : '❌'}`);
    console.log(`AI Configuration (OpenAI): ${aiConfig ? '✅' : '❌'}`);
    console.log(`Model Selected: ${model || 'gpt-4o-mini'}`);

    if (isActive !== 'true') {
        console.warn('⚠️ WARNING: Master Bot is NOT active. Bot will remain silent.');
    }

    if (aiConfig) {
        const parsed = JSON.parse(aiConfig);
        if (!parsed.openaiApiKey) {
            console.warn('⚠️ WARNING: OpenAI API Key is missing in ai_config.');
        } else {
            console.log('✅ OpenAI API Key present.');
        }
    } else {
        console.error('❌ ERROR: ai_config key is missing in Redis.');
    }

    process.exit(0);
}

diagnose();
