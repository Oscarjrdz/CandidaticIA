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

        const prompt = `Analiza si el siguiente texto es un NOMBRE DE PERSONA REAL válido: "${name}".

REGLAS DE IDENTIFICACIÓN:
1. NO debe ser un apodo obvio (ej: "Goku", "Naruto", "Tu Bebe", "La Toxica").
2. NO debe ser un nombre genérico (ej: "Usuario", "WhatsApp", "Business", "Cuenta", "Admin").
3. NO debe contener números ni emojis (salvo que se puedan limpiar fácilmente y quede un nombre real).
4. NO debe ser un nombre de empresa (ej: "Taller Mecánico", "Ventas", "Autolavado").
5. Debe parecer un nombre humano hispano/latino real (ej: "Juan Pérez", "María", "José Luis", "Brayan", "Kevin").

REGLAS DE SALIDA:
- Si ES un nombre real válido: Devuélvelo corregido con ACENTOS y formato Title Case (Mayúscula inicial en cada palabra).
- Si NO ES un nombre real válido: Responde con la palabra "INVALID" (todo mayúsculas).

Ejemplos:
- "juan perez" -> "Juan Pérez"
- "goku777" -> "INVALID"
- "taller mecanico" -> "INVALID"
- "jose" -> "José"
- "usuario whatsapp" -> "INVALID"
- "lic brenda" -> "Brenda" (extrae el nombre)

Respuesta:`;

        let cleaned = name;
        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: { temperature: 0.0 } // ZERO for max strictness
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

        if (cleaned === 'INVALID') return null;

        // Force Title Case Programmatically for safety
        if (cleaned && cleaned.length > 2) {
            return cleaned.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
        }

        return cleaned;

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
REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con el nombre de la categoría principal.
2. Si el usuario menciona varias, elige SOLO LA PRIMERA o la más relevante.
3. El resultado debe ser de MÁXIMO 2 o 3 palabras (Ej: "Almacén", "Chofer Repartidor", "Limpieza").
4. JAMÁS devuelvas frases largas o explicaciones.
Responde únicamente con la categoría limpia.
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

/**
 * Summarizes the employment status into "Sí" or "No" using Gemini AI
 * @param {string} statusPhrase - The crude phrase provided by candidate
 * @returns {Promise<string>} - "Sí" | "No"
 */
export async function cleanEmploymentStatusWithAI(statusPhrase) {
    if (!statusPhrase || statusPhrase.length < 1) return statusPhrase;

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

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') return statusPhrase;

        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro"];

        const prompt = `Analiza la siguiente frase sobre estatus laboral: "${statusPhrase}".
Determina de forma binaria si la persona TIENE empleo o NO TIENE empleo.
REGLAS ESTRICTAS:
1. Tu respuesta DEBE ser ÚNICAMENTE la palabra "Sí" o la palabra "No".
2. Si la persona menciona que tiene trabajo, está laborando, es empleado, o similar -> "Sí".
3. Si la persona dice que está desempleada, buscando, que no tiene trabajo, o es estudiante/ama de casa sin empleo -> "No".
4. Si la frase NO ES CLARA (ej: "hola", "info"), asume "No" por defecto para limpieza, o intenta inferir.
5. JAMÁS devuelvas la frase original. Solo "Sí" o "No".
Respuesta (Sí/No):`;

        let result = statusPhrase;
        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: { temperature: 0.1 }
                });
                const apiResult = await model.generateContent(prompt);
                const response = await apiResult.response;
                const text = response.text().trim().replace(/[.]/g, '');

                // Flexible matching
                if (text.toLowerCase().includes('sí') || text.toLowerCase().includes('si')) {
                    result = 'Sí';
                    break;
                }
                if (text.toLowerCase().includes('no')) {
                    result = 'No';
                    break;
                }
            } catch (err) {
                console.warn(`⚠️ [cleanEmploymentStatusWithAI] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        // FAIL-SAFE: If result is still too long (phrase), default to "No"
        if (result.length > 5) {
            return 'No';
        }

        return result;

    } catch (error) {
        console.error('❌ cleanEmploymentStatusWithAI error:', error.message);
        return statusPhrase;
    }
}
/**
 * Cleans and formats a date (e.g., date of birth) using Gemini AI
 * @param {string} dateStr - The crude date string from chat
 * @returns {Promise<string>} - Formatted date (YYYY-MM-DD or DD/MM/YYYY) or "INVALID"
 */
export async function cleanDateWithAI(dateStr) {
    if (!dateStr || dateStr.length < 1) return dateStr;

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

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') return dateStr;

        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro"];

        const prompt = `Analiza la siguiente fecha proporcionada por un usuario: "${dateStr}".
REGLAS:
1. Devuelve la fecha en formato estandarizado: "DD/MM/YYYY".
2. Si el usuario solo dice el año (ej: "de 1990"), o es ambiguo, intenta inferir el formato más probable.
3. Si el texto NO contiene una fecha válida o es un texto basura, responde únicamente con "INVALID".
4. Escribe únicamente la fecha formateada, sin puntos ni explicaciones.
Respuesta:`;

        let cleaned = dateStr;
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
                console.warn(`⚠️ [cleanDateWithAI] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        return cleaned || dateStr;

    } catch (error) {
        console.error('❌ cleanDateWithAI error:', error.message);
        return dateStr;
    }
}
/**
 * Homogenizes education level (Escolaridad) using Gemini AI
 * @param {string} escolaridad - The crude education level provided by candidate
 * @returns {Promise<string>} - Homogenized word (Primaria, Secundaria, Bachillerato, Licenciatura, Posgrado, N/A)
 */
export async function cleanEscolaridadWithAI(escolaridad) {
    if (!escolaridad || escolaridad.length < 1) return escolaridad;

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

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') return escolaridad;

        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const matchToken = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (matchToken) apiKey = matchToken[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro"];

        const prompt = `Analiza la siguiente descripción de escolaridad: "${escolaridad}".
Tu objetivo es clasificar este valor en una sola palabra o término estándar.

REGLAS DE HOMOGENEIZACIÓN (ESTRICTAS):
- "primaria", "elemental" -> "Primaria"
- "secundaria", "secu", "middle school", "secundaria trunca" -> "Secundaria"
- "preparatoria", "bachillerato", "prepa", "high school", "prepa trunca", "prepa terminada" -> "Prepa"
- "licenciatura", "ingeniería", "profesional", "universidad", "carrera", "lic trunca" -> "Licenciatura"
- "técnica", "carrera técnica", "conalep", "tecnico" -> "Técnica"
- "maestría", "doctorado", "especialidad" -> "Posgrado"
- Si es ambiguo o no menciona estudios -> "N/A"

CRÍTICO: Responde ÚNICAMENTE con una de las palabras del catálogo anterior. NO agregues "trunca", "terminada", ni ninguna otra palabra extra. Solo el término raíz.
Ejemplo: "Preparatoria trunca" -> "Prepa"
Ejemplo: "Ingeniería en sistemas" -> "Licenciatura"

Respuesta (UNA SOLA PALABRA):`;

        let cleaned = escolaridad;
        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: { temperature: 0.1 }
                });
                const apiResult = await model.generateContent(prompt);
                const response = await apiResult.response;
                cleaned = response.text().trim().replace(/[.]/g, '');
                if (cleaned && cleaned.length < 20) break; // Ensure it's a short response
            } catch (err) {
                console.warn(`⚠️ [cleanEscolaridadWithAI] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        return cleaned || escolaridad;

    } catch (error) {
        console.error('❌ cleanEscolaridadWithAI error:', error.message);
        return escolaridad;
    }
}
