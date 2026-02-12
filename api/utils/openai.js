import axios from 'axios';
import { getRedisClient } from './storage.js';

/**
 * OpenAI Adapter - The "Host" Brain
 */
export async function getOpenAIResponse(messages, systemPrompt = '', model = 'gpt-4o-mini', explicitApiKey = null) {
    try {
        const redis = getRedisClient();
        let apiKey = explicitApiKey ? explicitApiKey.trim() : process.env.OPENAI_API_KEY;

        // Try to get from Redis settings (ai_config) if not explicitly provided and not in process.env
        if (!apiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.openaiApiKey;
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey.trim() === '') {
            throw new Error('OPENAI_API_KEY not configured. Please add it in Settings.');
        }

        const formattedMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({
                role: (m.from === 'bot' || m.from === 'me') ? 'assistant' : 'user',
                content: m.content || m.parts?.[0]?.text || ''
            }))
        ];

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: model,
            messages: formattedMessages,
            temperature: 0.75,
            max_tokens: 800
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            },
            timeout: 25000
        });

        const choice = response.data.choices[0];
        return {
            content: choice.message.content,
            model: model,
            usage: response.data.usage
        };

    } catch (error) {
        const apiError = error.response?.data || error.message;
        console.error('❌ [OpenAI Adapter] Error:', apiError);
        throw new Error(`OpenAI Connection failed: ${typeof apiError === 'object' ? JSON.stringify(apiError) : apiError}`);
    }
}
