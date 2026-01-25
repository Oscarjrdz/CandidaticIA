
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getUltraMsgConfig, sendUltraMsgMessage } from './whatsapp/utils.js';
import { getCandidateIdByPhone, getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const phone = req.query.phone || '5218116038195';
    const message = "Hola, prueba de debug.";

    const results = {
        ai_generation: { status: 'pending' },
        ultramsg_delivery: { status: 'pending' },
        env_check: {}
    };

    try {
        const redis = getRedisClient();
        let apiKey = process.env.GEMINI_API_KEY;

        // ENV CHECK
        if (redis) {
            const aiConfig = await redis.get('ai_config');
            if (aiConfig) {
                const parsed = JSON.parse(aiConfig);
                if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            }
        }
        results.env_check.hasApiKey = !!apiKey;
        results.env_check.apiKeyPreview = apiKey ? `${apiKey.substring(0, 5)}...` : 'NONE';

        // 1. TEST AI GENERATION
        if (apiKey) {
            const genAI = new GoogleGenerativeAI(apiKey);
            const models = ["gemini-1.5-flash-latest", "gemini-1.5-flash-001", "gemini-1.0-pro"];

            results.ai_generation = [];

            for (const m of models) {
                const model = genAI.getGenerativeModel({ model: m });
                try {
                    const result = await model.generateContent("Di 'Funciono' en una palabra.");
                    const response = result.response;
                    results.ai_generation.push({ model: m, status: 'success', text: response.text() });
                    break; // Stop at first success
                } catch (e) {
                    results.ai_generation.push({ model: m, status: 'failed', error: e.message });
                }
            }
        } else {
            results.ai_generation = { status: 'skipped', reason: 'No API Key' };
        }

        // 2. TEST ULTRAMSG DELIVERY
        try {
            const config = await getUltraMsgConfig();
            if (config) {
                const sent = await sendUltraMsgMessage(config.instanceId, config.token, phone, "🤖 Debug: Prueba de envío directa.");
                results.ultramsg_delivery = {
                    status: 'success',
                    response: sent
                };
            } else {
                results.ultramsg_delivery = { status: 'failed', reason: 'No Config' };
            }
        } catch (e) {
            results.ultramsg_delivery = {
                status: 'failed',
                error: e.message
            };
        }

        return res.json(results);

    } catch (e) {
        return res.status(500).json({ error: e.message, stack: e.stack });
    }
}
