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

        if (!query) {
            return res.status(400).json({ error: 'Falta el parámetro "query"' });
        }

        // DYNAMIC IMPORTS
        const { getRedisClient, getCandidates, getMessages } = await import('../utils/storage.js');
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
            return res.status(500).json({
                error: 'AI no configurada',
                message: 'Falta GEMINI_API_KEY en Vercel o en la configuración de Settings. Por favor verifica que la llave sea válida.'
            });
        }

        // SANITIZACIÓN ROBUSTA
        apiKey = String(apiKey).trim();
        // 1. Quitar comillas
        apiKey = apiKey.replace(/^["']|["']$/g, '');
        // 2. Extraer solo la parte que parece una API Key de Google (empieza con AIzaSy)
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) {
            apiKey = match[0];
        } else {
            apiKey = apiKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '');
        }
        apiKey = apiKey.trim();

        const maskedKey = `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}`;

        // 2. Obtener campos disponibles para que la IA sepa qué buscar
        const DEFAULT_FIELDS = [
            { value: 'nombreReal', label: 'Nombre Real' },
            { value: 'genero', label: 'Género' },
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
        const genAI = new GoogleGenerativeAI(apiKey);

        const systemPrompt = `[ARCHITECTURE PROTOCOL: TITAN SEARCH v2]
Eres el Motor de Relevancia de Candidatic IA (Nivel Google/CTO). 
Tu tarea es convertir una consulta en lenguaje natural en un JSON de búsqueda semántica.

[REGLAS DE RELEVANCIA]:
1. INTENCIÓN SEMÁNTICA: Si el usuario busca un puesto, expande mentalmente a sinónimos. Ejemplo: "ventas" -> incluye keywords como "comercial", "ventas", "prospección", "atención al cliente".
2. PRIORIDAD DE CAMPOS: 
   - Nombres de personas -> 'nombreReal'.
   - Ciudades -> 'municipio'.
   - Puestos -> 'categoria'.
3. DESAMBIGUACIÓN (CRÍTICO): Oscar es el reclutador. Si la búsqueda es "oscar", busca candidatos con ese nombre, NUNCA devuelvas al reclutador.
4. KEYWORDS DE PERFIL: Usa 'keywords' para habilidades técnicas (Python, Excel), herramientas (Soldadura TIG) o rasgos psicológicos (responsable, puntual).

[BASE DE DATOS]:
${allFields.map(f => `- ${f.value} (${f.label})`).join('\n')}

{
  "filters": { 
    "municipio": "Monterrey", 
    "edad": { "op": ">", "val": 30 } 
  },
  "keywords": ["React", "liderazgo", "frontend"],
  "explanation": "Busco expertos de Monterrey con experiencia en liderazgo y desarrollo frontend."
}

Consulta del usuario: "${query}"

[ESCALA DE RELEVANCIA]:
- 100 pts: Coincidencia exacta en nombre o municipio.
- 50 pts: Coincidencia en 'categoria' o 'keywords'.
- 20 pts: Coincidencia en chat_summary o historial.
`;

        // Intentar varios modelos hasta que uno funcione (Prioridad Flash 2.0 por velocidad)
        const modelsToTry = [
            "gemini-2.0-flash",
            "gemini-2.0-flash-exp",
            "gemini-1.5-flash",
            "gemini-flash-latest",
            "gemini-1.5-pro",
            "gemini-pro"
        ];
        let result;
        let successModel = '';
        let lastError = '';

        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: {
                        temperature: 0.1, // Baja temperatura para más consistencia en JSON
                        response_mime_type: "application/json"
                    }
                });
                result = await model.generateContent(systemPrompt);
                successModel = mName;
                break;
            } catch (e) {
                lastError = e.message;
                console.warn(`⚠️[AI Query] ${mName} failed: `, e.message);
            }
        }

        if (!successModel) {
            throw new Error(`Ningún modelo respondió(probados: ${modelsToTry.join(', ')}).Último error: ${lastError} `);
        }

        const response = await result.response;
        const text = response.text();

        // Limpiar el texto si Gemini devuelve markdown ```json ... ```
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error(`La IA no devolvió un JSON válido.Respuesta: ${text} `);
        }

        const aiResponse = JSON.parse(jsonMatch[0]);

        // 3. Ejecutar la búsqueda en los datos reales (TODOS, incluyendo incompletos)
        const { candidates } = await getCandidates(2000, 0, '', false); // false = INCLUDE incomplete/unlinked

        // Función para calcular edad
        // Función para normalizar strings (quitar acentos, minúsculas)
        const normalizeString = (str) => {
            if (!str) return '';
            return String(str)
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .trim();
        };

        // Función para calcular edad (Robusta)
        const calculateAge = (dob) => {
            if (!dob) return null;
            let birthDate = new Date(dob);

            // Intentar parsear si la fecha estándar falló
            if (isNaN(birthDate.getTime())) {
                const cleanDob = String(dob).toLowerCase().trim();

                // 1. Formato "19 de 05 de 1983" o "19 de mayo de 1983"
                const deRegex = /(\d{1,2})\s+de\s+([a-z0-9áéíóú]+)\s+de\s+(\d{4})/;
                const match = cleanDob.match(deRegex);

                if (match) {
                    const day = parseInt(match[1]);
                    let month = match[2];
                    const year = parseInt(match[3]);
                    let monthIndex = -1;

                    // Si mes es número
                    if (!isNaN(month)) {
                        monthIndex = parseInt(month) - 1;
                    } else {
                        // Si mes es texto
                        const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                        monthIndex = months.findIndex(m => m.startsWith(month.slice(0, 3)));
                    }

                    if (monthIndex >= 0) {
                        birthDate = new Date(year, monthIndex, day);
                    }
                }

                // 2. Fallback a DD/MM/YYYY o DD-MM-YYYY
                if (isNaN(birthDate.getTime())) {
                    const parts = cleanDob.split(/[/-]/);
                    if (parts.length === 3) {
                        // Asumimos DD-MM-YYYY si el año está al final
                        if (parts[2].length === 4) {
                            birthDate = new Date(`${parts[2]} -${parts[1]} -${parts[0]} `);
                        }
                    }
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

        filtered = filtered.map(candidate => {
            let score = 0;

            // 1. Puntuar por Filtros de IA
            if (aiResponse.filters) {
                Object.entries(aiResponse.filters).forEach(([key, criteria]) => {
                    const searchStr = normalizeString(criteria.val || criteria);
                    if (!searchStr) return;

                    let candidateVal = candidate[key];
                    if (key === 'edad') candidateVal = calculateAge(candidate.fechaNacimiento);

                    const normalizedCandidateVal = normalizeString(candidateVal);
                    if (normalizedCandidateVal.includes(searchStr)) {
                        score += (key === 'nombreReal' || key === 'municipio') ? 100 : 50;
                    }
                });
            }

            // 2. Puntuar por Keywords (Deep Relevance)
            if (aiResponse.keywords && aiResponse.keywords.length > 0) {
                const keywordsLower = aiResponse.keywords.map(kw => kw.toLowerCase());
                const metadataValues = Object.values(candidate).map(v => String(v).toLowerCase());

                keywordsLower.forEach(kw => {
                    // Match in metadata
                    if (metadataValues.some(val => val.includes(kw))) score += 40;
                    // Match in summary
                    if (candidate.chat_summary && candidate.chat_summary.toLowerCase().includes(kw)) score += 30;
                });
            }

            return { ...candidate, _relevance: score, edad: calculateAge(candidate.fechaNacimiento) };
        });

        // 3. Optimización Titan: Deep Message Scan (Solo si el score es bajo y hay pocos resultados)
        // Para evitar lentitud, solo escaneamos mensajes si no hay matches altos
        const lowScoreCandidates = filtered.filter(c => c._relevance < 30).slice(0, 20);
        for (const candidate of lowScoreCandidates) {
            const messages = await getMessages(candidate.id, 20);
            const chatText = messages.map(m => m.content).join(' ').toLowerCase();

            if (aiResponse.keywords) {
                aiResponse.keywords.forEach(kw => {
                    if (chatText.includes(kw.toLowerCase())) {
                        const cIdx = filtered.findIndex(f => f.id === candidate.id);
                        if (cIdx !== -1) filtered[cIdx]._relevance += 25;
                    }
                });
            }
        }

        // 4. Ordenar por Relevancia (Google Style)
        filtered = filtered
            .filter(c => c._relevance > 0 || !aiResponse.filters) // Keep if matches or if query was too broad
            .sort((a, b) => b._relevance - a._relevance);

        return res.status(200).json({
            success: true,
            count: filtered.length,
            version: "Titan 2.1 (Google Search Edition)",
            candidates: filtered.slice(0, 100), // Return top 100 for UX
            ai: aiResponse
        });

    } catch (error) {
        console.error('❌ AI Query ERROR:', error);
        return res.status(500).json({
            success: false,
            error: `API ERROR: ${error.message} `,
            details: error.stack
        });
    }
}
