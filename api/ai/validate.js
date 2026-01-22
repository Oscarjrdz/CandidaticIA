import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let { apiKey } = req.body;

        if (!apiKey) {
            // Intenta obtener de Redis si no se pasa en el body (para validación inicial)
            const { getRedisClient } = await import('../utils/storage.js');
            const redis = getRedisClient();
            if (redis) {
                const config = await redis.get('ai_config');
                if (config) {
                    apiKey = JSON.parse(config).geminiApiKey;
                }
            }
        }

        if (!apiKey) {
            return res.status(400).json({ success: false, error: 'No se proporcionó una llave de API' });
        }

        const cleanKey = String(apiKey).trim();

        console.log(`🔌 [AI Validation] Testing key: ${cleanKey.substring(0, 10)}...`);

        const genAI = new GoogleGenerativeAI(cleanKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Petición mínima para validar
        const result = await model.generateContent("Valida esta conexión respondiendo solo 'OK'");
        const response = await result.response;
        const text = response.text();

        console.log(`✅ [AI Validation] Success:`, text);

        return res.status(200).json({
            success: true,
            message: 'Conexión exitosa',
            details: text.substring(0, 50)
        });

    } catch (error) {
        console.error('❌ [AI Validation] Failed:', error.message);
        return res.status(200).json({
            success: false,
            error: error.message
        });
    }
}
