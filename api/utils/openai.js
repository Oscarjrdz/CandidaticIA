import axios from 'axios';
import { getRedisClient } from './storage.js';

/**
 * OpenAI Adapter - The "Host" Brain
 */
export async function getOpenAIResponse(messages, systemPrompt = '', model = 'gpt-4o', explicitApiKey = null, responseFormat = null, multimodalSystemContent = null, maxTokens = 800) {
    try {
        const redis = getRedisClient();
        let apiKey = explicitApiKey ? explicitApiKey.trim() : process.env.OPENAI_API_KEY;

        // Try to get from Redis settings (ai_config) if not explicitly provided and not in process.env
        if (!apiKey && redis) {
            try {
                const aiConfigJson = await redis.get('ai_config');
                if (aiConfigJson) {
                    const aiConfig = JSON.parse(aiConfigJson);
                    apiKey = aiConfig.openaiApiKey;
                }
            } catch (rErr) {
                console.warn('[OpenAI Adapter] Redis read failed:', rErr.message);
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey.trim() === '') {
            throw new Error('OPENAI_API_KEY not configured. Please add it in Settings.');
        }

        let extraMessages = [];
        if (multimodalSystemContent && Array.isArray(multimodalSystemContent)) {
            extraMessages = [{
                role: 'user',
                content: [
                    { type: "text", text: "INSTRUCCIÓN DEL SISTEMA (BASE DE CONOCIMIENTO MULTIMODAL): Por favor revisa los siguientes adjuntos de la vacante antes de procesar el historial:" },
                    ...multimodalSystemContent
                ]
            }];
        }

        const formattedMessages = [
            { role: 'system', content: systemPrompt },
            ...extraMessages,
            ...messages.map(m => {
                // Robust role mapping
                let role = 'user';
                const from = m.from || '';
                const mRole = m.role || '';

                if (from === 'bot' || from === 'me' || mRole === 'model' || mRole === 'assistant') {
                    role = 'assistant';
                }

                // Robust content extraction
                const content = m.content || m.parts?.[0]?.text || '';

                return { role, content };
            })
        ];

        const payload = {
            model: model,
            messages: formattedMessages,
            temperature: 0.8,
            max_tokens: maxTokens
        };

        if (responseFormat) {
            payload.response_format = responseFormat;
        }

        const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000 // ⏱️ Strict 10s failsafe guillotine to prevent mutismo
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

/**
 * Generate Text-to-Speech audio returning a Base64 encoded payload.
 */
export async function generateTTS(text, voice = 'nova', model = 'tts-1') {
    try {
        const redis = getRedisClient();
        let apiKey = process.env.OPENAI_API_KEY;

        // Try to get from Redis settings (ai_config) if not explicitly provided and not in process.env
        if (!apiKey && redis) {
            try {
                const aiConfigJson = await redis.get('ai_config');
                if (aiConfigJson) {
                    const aiConfig = JSON.parse(aiConfigJson);
                    apiKey = aiConfig.openaiApiKey;
                }
            } catch (rErr) {
                console.warn('[OpenAI Adapter TS] Redis read failed:', rErr.message);
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey.trim() === '') {
            throw new Error('OPENAI_API_KEY not configured. Please add it in Settings.');
        }

        const payload = {
            model,
            voice,
            input: text,
            response_format: 'opus' // NATIVE WHATSAPP OGG OPUS
        };

        const response = await axios.post('https://api.openai.com/v1/audio/speech', payload, {
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer',
            timeout: 15000
        });

        const base64Audio = Buffer.from(response.data, 'binary').toString('base64');
        
        // WhatsApp APIs often fail processing raw Base64 data for audio/voice. 
        // We act as our own Media Server, saving the buffer to Redis and returning an HTTP URL.
        if (redis) {
            const id = `med_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const pipeline = redis.pipeline();
            pipeline.set(`image:${id}`, base64Audio, 'EX', 86400 * 7); // 7 days TTL (Ephemerial Voice Note)
            pipeline.set(`meta:image:${id}`, JSON.stringify({
                mime: 'audio/ogg; codecs=opus',
                filename: 'brenda_voice.opus',
                size: base64Audio.length,
                createdAt: new Date().toISOString()
            }), 'EX', 86400 * 7);
            await pipeline.exec();

            // Resolve Public Vercel Host
            let host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'candidatic-ia.vercel.app';
            if (!host.startsWith('http')) host = `https://${host}`;

            return `${host}/api/image?id=${id}&ext=.opus`;
        }

        // Fallback (might fail in strict Gateway implementations)
        return `data:audio/ogg;base64,${base64Audio}`;

    } catch (error) {
        const apiError = error.response?.data || error.message;
        console.error('❌ [OpenAI TTS] Error:', apiError instanceof Buffer ? apiError.toString('utf8') : apiError);
        throw new Error(`OpenAI TTS Connection failed: ${error.message}`);
    }
}
