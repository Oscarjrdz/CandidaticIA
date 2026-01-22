import { GoogleGenerativeAI } from "@google/generative-ai";
import { getCandidates, getMessages } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Falta el parámetro "query"' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({
                error: 'AI no configurada',
                message: 'Falta GEMINI_API_KEY en las variables de entorno.'
            });
        }

        // 1. Obtener campos disponibles para que la IA sepa qué buscar
        // Reutilizamos la lógica de api/fields.js
        const { getRedisClient } = await import('../utils/storage.js');
        const redis = getRedisClient();

        const DEFAULT_FIELDS = [
            { value: 'nombreReal', label: 'Nombre Real' },
            { value: 'fechaNacimiento', label: 'Fecha Nacimiento' },
            { value: 'municipio', label: 'Municipio' },
            { value: 'categoria', label: 'Categoría' },
            { value: 'tieneEmpleo', label: 'Tiene empleo' },
            { value: 'nombre', label: 'Nombre de WhatsApp' },
            { value: 'whatsapp', label: 'Teléfono/WhatsApp' }
        ];

        const customFieldsJson = await redis.get('custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
        const allFields = [...DEFAULT_FIELDS, ...customFields];

        // 2. Configurar Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const systemPrompt = `
Eres un experto en extracción de datos para un CRM de reclutamiento. 
Tu tarea es convertir una consulta en lenguaje natural en un objeto JSON de filtros.

Campos disponibles en la base de datos:
${allFields.map(f => `- ${f.value} (${f.label})`).join('\n')}

Reglas:
1. Devuelve SIEMPRE un JSON válido.
2. Identifica filtros exactos para los campos disponibles.
3. Si el usuario busca algo que no es un campo (ej: "busca gente que parezca enojada" o "que tenga buena actitud"), ponlo en el array "keywords".
4. Si menciona una ciudad o municipio, usa el campo "municipio".
5. Si menciona un puesto o vacante, usa el campo "categoria".

Estructura del JSON:
{
  "filters": { "campo": "valor" },
  "keywords": ["palabra1", "palabra2"],
  "explanation": "Breve explicación de lo que entendí"
}

Consulta del usuario: "${query}"
`;

        const result = await model.generateContent(systemPrompt);
        const response = await result.response;
        const text = response.text();

        // Limpiar el texto si Gemini devuelve markdown ```json ... ```
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("La IA no devolvió un formato válido.");
        }

        const aiResponse = JSON.parse(jsonMatch[0]);
        console.log('🤖 AI Parsed Query:', aiResponse);

        // 3. Ejecutar la búsqueda en los datos reales
        // Obtenemos todos los candidatos (hasta 1000 para este MVP)
        const candidates = await getCandidates(1000, 0);

        let filtered = candidates;

        // A. Filtrar por metadatos (campos exactos)
        if (aiResponse.filters && Object.keys(aiResponse.filters).length > 0) {
            filtered = filtered.filter(candidate => {
                return Object.entries(aiResponse.filters).every(([key, value]) => {
                    if (!candidate[key]) return false;
                    return String(candidate[key]).toLowerCase().includes(String(value).toLowerCase());
                });
            });
        }

        // B. Filtrar por palabras clave en el historial de chat (Búsqueda Profunda)
        if (aiResponse.keywords && aiResponse.keywords.length > 0 && filtered.length > 0) {
            const finalResults = [];
            for (const candidate of filtered) {
                const messages = await getMessages(candidate.id);
                const chatText = messages.map(m => m.content).join(' ').toLowerCase();

                const matchesKeywords = aiResponse.keywords.some(kw =>
                    chatText.includes(kw.toLowerCase())
                );

                if (matchesKeywords) {
                    finalResults.push(candidate);
                }
            }
            filtered = finalResults;
        }

        return res.status(200).json({
            success: true,
            count: filtered.length,
            candidates: filtered,
            ai: aiResponse
        });

    } catch (error) {
        console.error('❌ AI Query Error:', error);
        return res.status(500).json({
            error: 'Error procesando búsqueda inteligente',
            details: error.message
        });
    }
}
