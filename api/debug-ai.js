
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const report = {
        step1_env_key: 'PENDING',
        step2_redis_key: 'PENDING',
        step3_final_key_status: 'PENDING',
        step4_gemini_test: 'PENDING',
        error: null
    };

    try {
        // 1. Check Env
        const envKey = process.env.GEMINI_API_KEY;
        report.step1_env_key = envKey ? `Present (${envKey.substring(0, 5)}...)` : 'MISSING';

        // 2. Check Redis
        const redis = getRedisClient();
        let redisKey = null;
        if (redis) {
            const aiConfig = await redis.get('ai_config');
            if (aiConfig) {
                const parsed = JSON.parse(aiConfig);
                redisKey = parsed.geminiApiKey;
            }
            report.step2_redis_key = redisKey ? `Present (${redisKey.substring(0, 5)}...)` : 'MISSING';
        } else {
            report.step2_redis_key = 'REDIS_CONNECTION_FAILED';
        }

        // 3. Determined Key
        const finalKey = redisKey || envKey;
        if (!finalKey) {
            report.step3_final_key_status = 'CRITICAL_FAILURE: No API Key found anywhere.';
            return res.json(report);
        }
        report.step3_final_key_status = 'OK';

        // 4. Test Gemini connection
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const text = result.response.text();

        report.step4_gemini_test = `SUCCESS: Generated "${text}"`;

        return res.json(report);

    } catch (e) {
        report.error = {
            message: e.message,
            stack: e.stack,
            details: e.response || 'No details'
        };
        return res.status(500).json(report);
    }
}
