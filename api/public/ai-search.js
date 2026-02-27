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

        const { query } = body || {};

        if (!query) {
            return res.status(400).json({ error: 'Falta descripción del candidato' });
        }

        // DYNAMIC IMPORTS
        const { getRedisClient, getCandidates, getMessages } = await import('../../utils/storage.js');
        const redis = getRedisClient();

        // 1. Resolve API Key
        let apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey && redis) {
            try {
                const aiConfigJson = await redis.get('ai_config');
                if (aiConfigJson) {
                    const aiConfig = JSON.parse(aiConfigJson);
                    apiKey = aiConfig.openaiApiKey;
                }
            } catch (e) {
                console.warn('⚠️ [AI Search] Redis check failed:', e);
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
            console.error('❌ [AI Search] No API Key provided');
            return res.status(500).json({ error: 'AI no configurada' });
        }

        // Sistema de prompts
        const systemPrompt = `Eres un asistente de búsqueda para un Job Board (Bolsa de Trabajo) llamado Candidatic.
El usuario está buscando vacantes usando lenguaje natural.
Tu tarea es traducir su consulta a filtros estructurados y palabras clave.

CAMPOS DISPONIBLES:
- location: Municipio o zona (ej. Monterrey, Apodaca, Escobedo)
- category: Tipo de trabajo (ej. Limpieza, Guardia, Promotor, Recepcionista)
- salary_min: Si mencionan un sueldo mínimo esperado (usa números)

REGLAS:
- Extrae la categoría de trabajo en singular si es posible.
- Si no hay filtros obvios, pon las palabras importantes en 'keywords'.
- RESPONDE ÚNICAMENTE CON UN JSON VÁLIDO. No agregues texto antes ni después.

Consulta del usuario: "${query}"

EJEMPLO DE SALIDA:
{
  "filters": {
    "location": "Monterrey",
    "category": "Guardia"
  },
  "keywords": ["nocturno", "experiencia"]
}
`;

        const history = [{ role: 'system', content: systemPrompt }];
        const result = await getOpenAIResponse(history, query, 'gpt-4o-mini');

        if (!result || !result.content) {
            throw new Error(`La IA no devolvió una respuesta válida.`);
        }

        const text = result.content;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error(`La IA no devolvió un JSON válido.`);
        }

        const aiResponse = JSON.parse(jsonMatch[0]);

        // 3. Search Data
        const candidates = await getCandidates(1000, 0);

        // Helper: Age Calc
        const calculateAge = (dob) => {
            if (!dob) return null;
            let birthDate = new Date(dob);
            if (isNaN(birthDate.getTime())) {
                const parts = String(dob).split(/[/-]/);
                if (parts.length === 3 && parts[2].length === 4) {
                    birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                }
            }
            if (isNaN(birthDate.getTime())) return null;
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
            return age;
        };

        let filtered = candidates;

        // Apply Filters
        if (aiResponse.filters) {
            filtered = filtered.filter(candidate => {
                return Object.entries(aiResponse.filters).every(([key, criteria]) => {
                    let val = candidate[key];
                    if (key === 'edad') val = calculateAge(candidate.fechaNacimiento);
                    if (val === undefined || val === null) return false;

                    if (typeof criteria === 'object' && criteria.op) {
                        const numVal = parseFloat(criteria.val);
                        const numCand = parseFloat(val);
                        switch (criteria.op) {
                            case '>': return numCand > numVal;
                            case '<': return numCand < numVal;
                            case '>=': return numCand >= numVal;
                            case '<=': return numCand <= numVal;
                            default: return String(val).toLowerCase().includes(String(criteria.val).toLowerCase());
                        }
                    }
                    return String(val).toLowerCase().includes(String(criteria).toLowerCase());
                });
            });
        }

        // Keyword Search
        if (aiResponse.keywords && aiResponse.keywords.length > 0) {
            const finalResults = [];
            for (const c of filtered) {
                const match = Object.values(c).some(v =>
                    aiResponse.keywords.some(kw => String(v).toLowerCase().includes(kw.toLowerCase()))
                );
                // Note: We skip deep chat search for public API speed/privacy unless critical
                if (match) finalResults.push(c);
            }
            filtered = finalResults;
        }

        // 4. Sanitize Output (Privacy Protection)
        const privacySafePreview = filtered.slice(0, 10).map(c => ({
            role: c.categoria || 'Candidato General',
            location: c.municipio || 'N/A',
            age: calculateAge(c.fechaNacimiento) || 'N/A',
            skills: [c.categoria, c.municipio].filter(Boolean)
        }));

        return res.status(200).json({
            success: true,
            matches_count: filtered.length,
            preview: privacySafePreview,
            search_criteria: aiResponse
        });

    } catch (error) {
        console.error('Public Search Error:', error);
        return res.status(500).json({ error: 'Search failed' });
    }
}
