import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getUltraMsgConfig, sendUltraMsgMessage } from './whatsapp/utils.js';
import { getCandidateIdByPhone, getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const phone = req.query.phone || '5218116038195';
    const message = "Hola, prueba de debug.";

    const results = {
        ai_models_available: [],
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

        // 0. LIST AVAILABLE MODELS (Raw HTTP)
        if (apiKey) {
            try {
                const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
                const listRes = await axios.get(listUrl);
                results.ai_models_available = listRes.data.models ? listRes.data.models.map(m => m.name) : 'No models field';
            } catch (e) {
                results.ai_models_available = { error: e.message, data: e.response?.data };
            }
        }

        // 1. TEST AI GENERATION (Try with the first available model if any found, else fallback)
        if (apiKey) {
            const genAI = new GoogleGenerativeAI(apiKey);
            // Pick a model from the list if available, or try a default
            let modelToTest = "gemini-1.5-flash";
            if (Array.isArray(results.ai_models_available) && results.ai_models_available.length > 0) {
                // Try to find a generation model
                const preferred = results.ai_models_available.find(m => m.includes('generate') || m.includes('pro') || m.includes('flash'));
                if (preferred) modelToTest = preferred.replace('models/', '');
            }

            results.ai_generation = { trying_model: modelToTest };

            try {
                const model = genAI.getGenerativeModel({ model: modelToTest });
                const result = await model.generateContent("Di 'Funciono' en una palabra.");
                const response = result.response;
                results.ai_generation.status = 'success';
                results.ai_generation.text = response.text();
            } catch (e) {
                results.ai_generation.status = 'failed';
                results.ai_generation.error = e.message;
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
