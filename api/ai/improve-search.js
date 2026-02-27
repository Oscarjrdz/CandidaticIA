import { getOpenAIResponse } from '../utils/openai.js';
import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required' });

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
                console.warn('⚠️ [AI Improve Search] Redis check failed:', e);
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
            return res.status(500).json({ error: 'AI no configurada' });
        }

        const systemPrompt = `Eres un asistente de búsqueda técnica en una base de datos de candidatos.
El usuario ha intentado una búsqueda que devolvió 0 resultados.
Tu tarea es analizar la búsqueda original y sugerir UNA versión más amplia o mejor redactada, enfocada en habilidades centrales.

REGLAS:
1. Devuelve SOLO UN JSON válido.
2. Formato: { "suggestedQuery": "nueva busqueda mejorada", "reasoning": "Por qué lo cambiaste (breve)" }
3. Si la búsqueda original es muy específica (ej. "programador java con 5 años de experiencia en AWS"), redúcela a lo esencial (ej. "programador java AWS").
4. Corrige errores ortográficos si los hay.

Búsqueda Original: "${prompt}"
`;

        const history = [{ role: 'system', content: systemPrompt }];
        const result = await getOpenAIResponse(history, prompt, 'gpt-4o-mini');

        if (!result || !result.content) {
            throw new Error(`La IA no devolvió una sugerencia válida.`);
        }

        const text = result.content;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error(`La IA no devolvió un JSON válido.`);
        }

        const aiResponse = JSON.parse(jsonMatch[0]);

        return res.status(200).json({ success: true, improvedSearch: aiResponse.suggestedQuery });
    } catch (error) {
        console.error('❌ Improve Search Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
