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

        const prompt = `Corrige la ortografía, ACENTUACIÓN y sintaxis del nombre de persona: "${name}".
REGLAS CRÍTICAS:
1. DEBES poner acentos en apellidos que los lleven de forma obligatoria (ej: "Rodriguez" -> "Rodríguez", "Sanchez" -> "Sánchez", "Gomez" -> "Gómez", "Martinez" -> "Martínez", "Hernandez" -> "Hernández").
2. Corrige nombres comunes (ej: "Ramon" -> "Ramón", "Jose" -> "José", "Maria" -> "María").
3. No inventes nombres nuevos, solo limpia y corrige el que te doy.
4. Formatea el resultado estrictamente con Mayúscula Inicial en cada palabra (Title Case).
5. Responde únicamente con el nombre corregido, sin puntos finales ni explicaciones.
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

/**
 * Cleans and validates a municipality name using Gemini AI
 * @param {string} municipio - The crude municipality name
 * @returns {Promise<string>} - Cleaned official municipality name
 */
export async function cleanMunicipioWithAI(municipio) {
    if (!municipio || municipio.length < 2) return municipio;

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

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') return municipio;

        // Sanitize API Key
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro"];

        const prompt = `Corrige la ortografía y devuelve el nombre OFICIAL y COMPLETO del municipio: "${municipio}".
REGLAS IMPORTANTES:
1. Prioriza municipios del estado de Nuevo León, México.
2. Si el usuario dice un nombre corto o informal, conviértelo al oficial.
   - Ejemplo: "Escobedo" -> "General Mariano Escobedo"
   - Ejemplo: "San Pedro" -> "San Pedro Garza García"
   - Ejemplo: "San Nicolás" -> "San Nicolás de los Garza"
   - Ejemplo: "Apodaca" -> "Ciudad Apodaca"
   - Ejemplo: "Santa" -> "Santa Catarina"
3. Si es de otro estado de México, también corrígelo a su nombre oficial.
4. Si no es un municipio o es ambiguo, devuélvelo corregido ortográficamente en Title Case.
Responde únicamente con el nombre oficial del municipio, sin estados, sin puntos ni explicaciones.
Respuesta:`;

        let cleaned = municipio;
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
                console.warn(`⚠️ [cleanMunicipioWithAI] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        return cleaned || municipio;

    } catch (error) {
        console.error('❌ cleanMunicipioWithAI error:', error.message);
        return municipio;
    }
}

/**
 * Cleans and formats a job category name using Gemini AI
 * @param {string} category - The crude category word/phrase
 * @returns {Promise<string>} - Cleaned Title Case category
 */
export async function cleanCategoryWithAI(category) {
    if (!category || category.length < 2) return category;

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

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') return category;

        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro"];

        const prompt = `Corrige la ortografía, ACENTUACIÓN y formato de la categoría de empleo: "${category}".
REGLAS:
1. Corrige errores ortográficos y pon acentos (ej: "operario" -> "Operario", "almacen" -> "Almacén", "logistica" -> "Logística").
2. Formatea en Title Case (Mayúscula Inicial).
3. Si es una frase, corrígela para que suene profesional.
Responde únicamente con la categoría limpia, sin puntos ni explicaciones.
Respuesta:`;

        let cleaned = category;
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
                console.warn(`⚠️ [cleanCategoryWithAI] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        return cleaned || category;

    } catch (error) {
        console.error('❌ cleanCategoryWithAI error:', error.message);
        return category;
    }
}
