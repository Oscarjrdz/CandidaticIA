
import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        // 1. Delete the custom prompt (forces usage of DEFAULT_SYSTEM_PROMPT in agent.js)
        await redis.del('bot_ia_prompt');

        // 2. Ensure bot is active
        await redis.set('bot_ia_active', 'true');

        return res.json({
            success: true,
            message: '🧠 AI Brain Factory Reset Complete. Custom prompts removed. Default Strict Prompt is now active.',
            deleted_keys: ['bot_ia_prompt']
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
