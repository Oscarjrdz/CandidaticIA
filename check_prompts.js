
import { getRedisClient } from './api/utils/storage.js';

async function check() {
    const redis = getRedisClient();
    const systemPrompt = await redis.get('bot_ia_prompt');
    const assistantPrompt = await redis.get('assistant_ia_prompt');

    console.log('--- SYSTEM PROMPT (bot_ia_prompt) ---');
    console.log(systemPrompt || '(None)');
    console.log('\n--- ASSISTANT PROMPT (assistant_ia_prompt) ---');
    console.log(assistantPrompt || '(None)');

    process.exit(0);
}

check();
