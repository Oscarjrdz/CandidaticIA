
import { getRedisClient } from './api/utils/storage.js';
import { getOpenAIResponse } from './api/utils/openai.js';

async function testConnection() {
    console.log('--- GPT HOST CONNECTION TEST ---');

    // 1. Load Config
    const redis = getRedisClient();
    const configRaw = await redis.get('ai_config');
    const aiConfig = configRaw ? JSON.parse(configRaw) : {};

    console.log('Config Logic:', {
        enabled: aiConfig.gptHostEnabled,
        model: aiConfig.openaiModel,
        hasKey: !!aiConfig.openaiApiKey,
        keyLength: aiConfig.openaiApiKey ? aiConfig.openaiApiKey.length : 0
    });

    if (!aiConfig.openaiApiKey) {
        console.error('❌ NO API KEY FOUND');
        process.exit(1);
    }

    // 2. Test Call
    try {
        console.log('🚀 Attempting to call OpenAI...');
        const messages = [{ role: 'user', content: 'Say "Hello Host" if you can hear me.' }];
        const response = await getOpenAIResponse(messages, 'You are a test bot.', aiConfig.openaiModel || 'gpt-4o-mini');

        console.log('✅ RESPONSE RECEIVED:');
        console.log(JSON.stringify(response, null, 2));

        if (response && response.content) {
            console.log('🎉 SUCCESS! The Host is ALIVE.');
        } else {
            console.log('⚠️ Warning: Response format unexpected.');
        }

    } catch (e) {
        console.error('❌ FATAL ERROR CALLING OPENAI:', e.message);
        if (e.response) {
            console.error('Data:', e.response.data);
            console.error('Status:', e.response.status);
        }
    }

    process.exit(0);
}

testConnection();
