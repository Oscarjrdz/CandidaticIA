import { getOpenAIResponse } from '../utils/openai.js';

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

        let apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey && redis) {
            try {
                const aiConfigJson = await redis.get('ai_config');
                if (aiConfigJson) {
                    const aiConfig = JSON.parse(aiConfigJson);
                    apiKey = aiConfig.openaiApiKey;
                }
            } catch (e) {
                console.warn('⚠️ [AI Action] Redis check failed:', e);
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
            console.error('❌ [AI Action] No API Key provided');
            return res.status(500).json({ error: 'AI no configurada' });
        }

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

        const history = [{ role: 'system', content: systemPrompt }];
        const result = await getOpenAIResponse(history, query, 'gpt-4o-mini');

        if (!result || !result.content) {
            throw new Error(`La IA no devolvió una respuesta válida.`);
        }

        let jsonText = result.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
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
