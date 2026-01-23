import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Detects gender (Hombre/Mujer) based on a name using Gemini AI
 * @param {string} name - The name to analyze
 * @returns {Promise<string>} - "Hombre" | "Mujer" | "Desconocido"
 */
export async function detectGender(name) {
    if (!name || name === 'Sin nombre' || name.length < 2) return 'Desconocido';

    try {
        const { getRedisClient } = await import('./storage.js');
        const redis = getRedisClient();

        let apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.geminiApiKey;
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
            console.warn('⚠️ GEMINI_API_KEY not configured for gender detection');
            return 'Desconocido';
        }

        // Sanitize API Key
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);

        // List of robust models to try
        const modelsToTry = [
            "gemini-2.0-flash",
            "gemini-2.0-flash-exp",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
            "gemini-pro"
        ];

        const prompt = `Dime si el nombre "${name}" es de un hombre o de una mujer.
Responde únicamente con una palabra: "Hombre", "Mujer" o "Desconocido" (si es totalmente ambiguo o no es un nombre).
Ignora apellidos si los hay.
Respuesta:`;

        let text = '';
        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: { temperature: 0.1 }
                });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                text = response.text().trim().replace(/[.]/g, '');
                if (text) break;
            } catch (err) {
                console.warn(`⚠️ [detectGender] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        if (text.includes('Hombre')) return 'Hombre';
        if (text.includes('Mujer')) return 'Mujer';

        return 'Desconocido';

    } catch (error) {
        console.error('❌ detectGender error:', error.message);
        return 'Desconocido';
    }
}

/**
 * Cleans and formats a person's name using Gemini AI
 * @param {string} name - The crude name from chat or WhatsApp
 * @returns {Promise<string>} - Cleaned Title Case name
 */
export async function cleanNameWithAI(name) {
    if (!name || name === 'Sin nombre' || name.length < 2) return name;

    try {
        const { getRedisClient } = await import('./storage.js');
        const redis = getRedisClient();

        let apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.geminiApiKey;
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') return name;

        // Sanitize API Key
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro"];

        const prompt = `Corrige la ortografía y sintaxis del nombre de persona: "${name}".
No inventes nombres nuevos, solo limpia y corrige el que te doy.
Formatea el resultado estrictamente con Mayúscula Inicial en cada palabra (Title Case).
Si no parece ser un nombre de persona, devuélvelo tal cual pero en Title Case.
Responde únicamente con el nombre corregido, sin puntos finales ni explicaciones.
Respuesta:`;

        let cleaned = name;
        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: { temperature: 0.1 }
                });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                cleaned = response.text().trim().replace(/[.]/g, '');
                if (cleaned) break;
            } catch (err) {
                console.warn(`⚠️ [cleanNameWithAI] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        return cleaned || name;

    } catch (error) {
        console.error('❌ cleanNameWithAI error:', error.message);
        return name;
    }
}
