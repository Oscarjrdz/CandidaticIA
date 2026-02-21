import { getRedisClient } from '../utils/storage.js';
import { classifyIntent } from '../ai/intent-classifier.js';
import { FEATURES } from '../utils/feature-flags.js';
import { getCachedConfig } from '../utils/cache.js';
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        let apiKey = process.env.GEMINI_API_KEY;
        let p_status = apiKey ? "Found in ENV" : "Not in ENV";

        if (!apiKey && redis) {
            const aiConfigJson = FEATURES.USE_BACKEND_CACHE
                ? await getCachedConfig(redis, 'ai_config')
                : await redis.get('ai_config');

            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.geminiApiKey;
                p_status += apiKey ? " / Found in REDIS" : " / Not in REDIS";
            }
        }

        if (!apiKey) {
            return res.status(200).send(`API KEY MISSING. Path: ${p_status}`);
        }

        const intent = await classifyIntent('test_1', "Esta vacante no me interesa", "Contexto previo: Te envié información de la vacante Prolec.");
        res.status(200).send(`API KEY: ${p_status} | Intent: ${intent}`);
    } catch (e) {
        res.status(500).send(e.toString() + "\n" + e.stack);
    }
}
