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

        // SANITIZACIÓN ROBUSTA
        let cleanKey = String(apiKey).trim();
        // Eliminar comillas si las pegó con ellas
        cleanKey = cleanKey.replace(/^["']|["']$/g, '');
        // Eliminar prefijos si pegó el nombre de la variable
        cleanKey = cleanKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '');
        cleanKey = cleanKey.trim();

        const maskedKey = `${cleanKey.substring(0, 6)}...${cleanKey.substring(cleanKey.length - 4)}`;
        console.log(`🔌 [AI Validation] Testing key: ${maskedKey}`);

        const genAI = new GoogleGenerativeAI(cleanKey);

        // Intentar con flash primero, luego con pro si falla con 404
        let text = '';
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent("Valida esta conexión respondiendo solo 'OK'");
            const response = await result.response;
            text = response.text();
        } catch (e) {
            if (e.message.includes('404') || e.message.includes('not found')) {
                console.log('⚠️ Flash not found, trying gemini-pro...');
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                const result = await model.generateContent("Valida esta conexión");
                const response = await result.response;
                text = response.text();
            } else {
                throw e;
            }
        }

        console.log(`✅ [AI Validation] Success:`, text);

        return res.status(200).json({
            success: true,
            message: 'Conexión exitosa',
            details: text.substring(0, 50)
        });

    } catch (error) {
        console.error('❌ [AI Validation] Failed:', error.message);

        // Diagnóstico para el usuario
        let finalError = error.message;
        if (finalError.includes('404') || finalError.includes('not found')) {
            finalError = `Error 404: El modelo no está disponible. DEBES ACTIVAR la "Generative Language API" aquí: https://aistudio.google.com/app/apikey (haz clic en tu proyecto y busca 'Enable API')`;
        }
        const apiKeyUsed = String(req.body?.apiKey || '').trim();
        const maskedDiagnostic = apiKeyUsed.length > 10
            ? `(Llave: ${apiKeyUsed.substring(0, 6)}...${apiKeyUsed.substring(apiKeyUsed.length - 4)})`
            : '(Llave vacía)';

        return res.status(200).json({
            success: false,
            error: `${finalError} ${maskedDiagnostic}`
        });
    }
}
