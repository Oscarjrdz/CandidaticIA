
import { getRedisClient } from '../utils/storage.js';
import { getOpenAIResponse } from '../utils/openai.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        const configRaw = await redis.get('ai_config');
        const aiConfig = configRaw ? JSON.parse(configRaw) : {};

        const report = {
            step: 'GPT_CONNECTION_TEST',
            config: {
                gptHostEnabled: aiConfig.gptHostEnabled,
                model: aiConfig.openaiModel || 'gpt-4o-mini',
                hasKey: !!aiConfig.openaiApiKey,
                keyPrefix: aiConfig.openaiApiKey ? aiConfig.openaiApiKey.substring(0, 7) : 'NONE'
            },
            testResult: null,
            error: null
        };

        if (!aiConfig.openaiApiKey) {
            report.error = 'MISSING_API_KEY';
            return res.status(500).json(report);
        }

        // Test Call
        const messages = [{ role: 'user', content: 'Say "Hello Host" if you can hear me.' }];
        try {
            const start = Date.now();
            const response = await getOpenAIResponse(messages, 'You are a test bot.', report.config.model);
            report.testResult = {
                success: true,
                content: response.content,
                latency: Date.now() - start
            };
        } catch (openaiErr) {
            report.error = openaiErr.message;
            if (openaiErr.response) {
                report.details = openaiErr.response.data;
            }
        }

        return res.json(report);

    } catch (e) {
        return res.status(500).json({ error: e.message, stack: e.stack });
    }
}
