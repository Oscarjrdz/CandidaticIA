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

        // 1. Quitar comillas
        cleanKey = cleanKey.replace(/^["']|["']$/g, '');

        // 2. Extraer solo la parte que parece una API Key de Google (empieza con AIzaSy)
        // Esto ignora prefijos como "GEMINI_API_KEY=", project IDs, o espacios extraños
        const match = cleanKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) {
            cleanKey = match[0];
        } else {
            // Si no tiene el formato estándar, al menos quitar el prefijo común por si acaso
            cleanKey = cleanKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '');
        }

        cleanKey = cleanKey.trim();

        const maskedKey = `${cleanKey.substring(0, 6)}...${cleanKey.substring(cleanKey.length - 4)}`;

        const genAI = new GoogleGenerativeAI(cleanKey);

        // Intentar varios modelos hasta que uno funcione
        const modelsToTry = [
            "gemini-flash-latest",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
            "gemini-pro-latest",
            "gemini-pro",
            "gemini-2.0-flash"
        ];
        let successModel = '';
        let text = '';
        let lastError = '';
        let allErrors = [];
        for (const modelName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("OK");
                const response = await result.response;
                text = response.text();
                successModel = modelName;
                break;
            } catch (e) {
                const errorDetail = `${modelName}: ${e.message}`;
                allErrors.push(errorDetail);
                lastError = errorDetail;
                console.warn(`⚠️ [AI Validation] ${modelName} failed:`, e.message);

                if (e.message.includes('429') || e.message.includes('API_KEY_INVALID')) {
                    break;
                }
            }
        }

        if (!successModel) {
            throw new Error(`Detalles: ${allErrors.join(' | ')}`);
        }


        return res.status(200).json({
            success: true,
            message: 'Conexión exitosa',
            details: text.substring(0, 50)
        });

    } catch (error) {
        console.error('❌ [AI Validation] Failed:', error.message);

        // Diagnóstico para el usuario (incluyendo el error técnico real)
        let technicalError = error.message;
        let finalError = technicalError;

        if (technicalError.includes('404') || technicalError.includes('not found')) {
            finalError = `Error 404: El modelo no está disponible. DEBES ACTIVAR la "Generative Language API" o Google AI Studio. Detalles: ${technicalError}`;
        }

        const apiKeyUsed = String(req.body?.apiKey || '').trim();
        const maskedDiagnostic = apiKeyUsed.length > 10
            ? `(Llave: ${apiKeyUsed.substring(0, 6)}...${apiKeyUsed.substring(apiKeyUsed.length - 4)})`
            : '(Llave vacía)';

        return res.status(200).json({
            success: false,
            error: `[DEBUG-B3] ${finalError} ${maskedDiagnostic}`
        });
    }
}
