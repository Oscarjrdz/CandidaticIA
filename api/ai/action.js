import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { query, context } = body || {};

        if (!query) {
            console.error('❌ [AI Action] Missing query');
            return res.status(400).json({ error: 'Falta el parámetro "query"' });
        }

        // DYNAMIC IMPORTS & AUTH (Same as query.js)
        const { getRedisClient } = await import('../utils/storage.js');
        const redis = getRedisClient();

        let apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey && redis) {
            try {
                const aiConfigJson = await redis.get('ai_config');
                if (aiConfigJson) {
                    const aiConfig = JSON.parse(aiConfigJson);
                    apiKey = aiConfig.geminiApiKey;
                }
            } catch (e) {
                console.warn('⚠️ [AI Action] Redis check failed:', e);
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
            console.error('❌ [AI Action] No API Key provided');
            return res.status(500).json({ error: 'AI no configurada' });
        }

        // Sanitización de Key (Robusta, igual que query.js)
        apiKey = String(apiKey).trim();
        apiKey = apiKey.replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) {
            apiKey = match[0];
        } else {
            apiKey = apiKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '');
        }
        apiKey = apiKey.trim();


        // Configurar Gemini
        const genAI = new GoogleGenerativeAI(apiKey);

        const systemPrompt = `
Eres un asistente de acción para un CRM de reclutamiento.
El usuario acaba de ver una lista de candidatos y te está pidiendo qué hacer con ellos.
Tu tarea es clasificar su intención y extraer la información relevante.

CATEGORÍAS DE ACCIÓN:
1. "REFINE_FILTER": El usuario quiere filtrar más la lista actual.
   - Ejemplos: "que sepan ingles", "solo los de monterrey", "filtrar por edad > 30".
   - Salida esperada: Un objeto de filtros igual que en la búsqueda normal.

REGLAS:
- Devuelve SIEMPRE un JSON válido.
- Estructura:
{
  "intent": "REFINE_FILTER" | "UNKNOWN",
  "filters": { ... }, // Solo si intent es REFINE_FILTER
  "explanation": "..." // Breve explicación de lo que harás.
}

Datos de contexto:
- Candidatos seleccionados: ${context?.candidateCount || 0}

Consulta del usuario: "${query}"
`;

        // Intentar varios modelos hasta que uno funcione (Igual que query.js)
        const modelsToTry = [
            "gemini-flash-latest",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
            "gemini-pro-latest",
            "gemini-pro"
        ];
        let result;
        let successModel = '';
        let lastError = '';

        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: mName });
                result = await model.generateContent(systemPrompt);
                successModel = mName;
                break;
            } catch (e) {
                lastError = e.message;
                console.warn(`⚠️ [AI Action] ${mName} failed:`, e.message);
            }
        }

        if (!successModel) {
            console.error('❌ [AI Action] All models failed. Last error:', lastError);
            throw new Error(`Ningún modelo respondió. Último error: ${lastError}`);
        }

        const response = await result.response;
        const text = response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error(`La IA no devolvió un JSON válido.`);
        }

        const aiResponse = JSON.parse(jsonMatch[0]);

        return res.status(200).json({
            success: true,
            action: aiResponse
        });

    } catch (error) {
        console.error('❌ AI Action ERROR:', error);
        return res.status(500).json({
            success: false,
            error: `API ERROR: ${error.message}`
        });
    }
}
