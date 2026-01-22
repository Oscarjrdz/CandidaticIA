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

        // Intentar varios modelos hasta que uno funcione
        const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-pro"];
        let successModel = '';
        let text = '';
        let lastError = '';

        for (const modelName of modelsToTry) {
            try {
                console.log(`🔌 [AI Validation] Testing: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("OK");
                const response = await result.response;
                text = response.text();
                successModel = modelName;
                break;
            } catch (e) {
                lastError = e.message;
                console.warn(`⚠️ [AI Validation] ${modelName} failed:`, e.message);
            }
        }

        if (!successModel) {
            throw new Error(`Ningún modelo respondió (probados: ${modelsToTry.join(', ')}). Último error: ${lastError}`);
        }

        console.log(`✅ [AI Validation] Success with: ${successModel}`);

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
