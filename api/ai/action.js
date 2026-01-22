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
        console.log(`🔍 [AI Action] Query: "${query}"`);

        if (!query) {
            return res.status(400).json({ error: 'Falta el parámetro "query"' });
        }

        // DYNAMIC IMPORTS & AUTH (Same as query.js)
        const { getRedisClient } = await import('../../utils/storage.js');
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
            return res.status(500).json({ error: 'AI no configurada' });
        }

        // Sanitización de Key
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];
        else apiKey = apiKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '').trim();


        // Configurar Gemini
        const genAI = new GoogleGenerativeAI(apiKey);

        const systemPrompt = `
Eres un asistente de acción para un CRM de reclutamiento.
El usuario acaba de ver una lista de candidatos y te está pidiendo qué hacer con ellos.
Tu tarea es clasificar su intención en una de dos categorías y extraer la información relevante.

CATEGORÍAS DE ACCIÓN:
1. "REFINE_FILTER": El usuario quiere filtrar más la lista actual.
   - Ejemplos: "que sepan ingles", "solo los de monterrey", "filtrar por edad > 30".
   - Salida esperada: Un objeto de filtros igual que en la búsqueda normal.

2. "BULK_MESSAGE": El usuario quiere enviar un mensaje a estos candidatos.
   - Ejemplos: "mandales un saludo", "invitalos a entrevista", "diles hola".
   - Salida esperada: Un string con el mensaje sugerido (o null si es genérico).

REGLAS:
- Devuelve SIEMPRE un JSON válido.
- Estructura:
{
  "intent": "REFINE_FILTER" | "BULK_MESSAGE" | "UNKNOWN",
  "filters": { ... }, // Solo si intent es REFINE_FILTER
  "message": "..." // Solo si intent es BULK_MESSAGE. Genera un mensaje corto y profesional si el usuario no especificó uno exacto.
  "explanation": "..." // Breve explicación de lo que harás.
}

Datos de contexto:
- Candidatos seleccionados: ${context?.candidateCount || 0}

Consulta del usuario: "${query}"
`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(systemPrompt);
        const response = await result.response;
        const text = response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error(`La IA no devolvió un JSON válido.`);
        }

        const aiResponse = JSON.parse(jsonMatch[0]);
        console.log('🤖 AI Action Response:', aiResponse);

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
