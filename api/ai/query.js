import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Robust body parsing for Vercel
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { query } = body || {};
        console.log(`🔍 [AI Query] Query received: "${query}"`);

        if (!query) {
            return res.status(400).json({ error: 'Falta el parámetro "query"' });
        }

        // DYNAMIC IMPORTS
        const { getRedisClient, getCandidates, getMessages } = await import('../utils/storage.js');
        const redis = getRedisClient();

        let apiKey = process.env.GEMINI_API_KEY;
        console.log(`🔍 [AI Query] Env API Key present: ${!!apiKey}`);

        if (!apiKey && redis) {
            console.log(`🔍 [AI Query] Key missing in Env, checking Redis...`);
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.geminiApiKey;
                console.log(`🔍 [AI Query] Found key in Redis: ${!!apiKey}`);
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
            return res.status(500).json({
                error: 'AI no configurada',
                message: 'Falta GEMINI_API_KEY en Vercel o en la configuración de Settings. Por favor verifica que la llave sea válida.'
            });
        }

        // SANITIZACIÓN ROBUSTA
        apiKey = String(apiKey).trim();
        apiKey = apiKey.replace(/^["']|["']$/g, '');
        apiKey = apiKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '');
        apiKey = apiKey.trim();

        const maskedKey = `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}`;

        // 2. Obtener campos disponibles para que la IA sepa qué buscar
        const DEFAULT_FIELDS = [
            { value: 'nombreReal', label: 'Nombre Real' },
            { value: 'fechaNacimiento', label: 'Fecha Nacimiento' },
            { value: 'municipio', label: 'Municipio' },
            { value: 'categoria', label: 'Categoría' },
            { value: 'tieneEmpleo', label: 'Tiene empleo' },
            { value: 'nombre', label: 'Nombre de WhatsApp' },
            { value: 'whatsapp', label: 'Teléfono/WhatsApp' }
        ];

        let allFields = [...DEFAULT_FIELDS];
        try {
            const customFieldsJson = await redis.get('custom_fields');
            const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
            allFields = [...DEFAULT_FIELDS, ...customFields];
        } catch (e) {
            console.warn('⚠️ No se pudieron cargar los campos personalizados:', e.message);
        }

        // 2. Configurar Gemini
        console.log(`🔍 [AI Query] Initializing Gemini Model...`);
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

        console.log(`🔍 [AI Query] Sending to Gemini...`);
        const result = await model.generateContent(systemPrompt);
        const response = await result.response;
        const text = response.text();
        console.log(`🔍 [AI Query] Gemini raw response text:`, text);

        // Limpiar el texto si Gemini devuelve markdown ```json ... ```
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error(`La IA no devolvió un JSON válido. Respuesta: ${text}`);
        }

        const aiResponse = JSON.parse(jsonMatch[0]);
        console.log('🤖 AI Parsed Query:', aiResponse);

        // 3. Ejecutar la búsqueda en los datos reales
        console.log(`🔍 [AI Query] Searching records...`);
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
        console.error('❌ AI Query ERROR:', error);
        return res.status(500).json({
            success: false,
            error: `API ERROR: ${error.message}`,
            details: error.stack
        });
    }
}
