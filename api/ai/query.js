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

        const systemPrompt = `
Eres un experto en extracción de datos para un CRM de reclutamiento (Candidatic). 
Tu tarea es convertir una consulta en lenguaje natural en un objeto JSON de filtros lógicos.

Campos disponibles en la base de datos:
${allFields.map(f => `- ${f.value} (${f.label})`).join('\n')}

IMPORTANTE: El campo 'edad' NO existe directamente, pero puedes pedirlo en 'filters' y lo calcularemos desde 'fechaNacimiento'.

Reglas:
1. Devuelve SIEMPRE un JSON válido. No incluyas explicaciones fuera del JSON.
2. Filtros: Usa el campo 'filters' para criterios técnicos.
3. Operadores: Si el usuario pide "mayor a", "menor que", "más de", usa un objeto con { "op": ">", "val": valor }. 
   Operadores permitidos: ">", "<", ">=", "<=", "==", "contains".
4. Edad: Si piden "más de 40 años", usa { "filters": { "edad": { "op": ">", "val": 40 } } }.
5. Keywords: Usa 'keywords' para conceptos abstractos o habilidades (ej: "React", "buena actitud", "responsable") que buscaremos en el chat.
6. Si menciona una ciudad, usa "municipio". 
7. Si menciona un puesto (ej: "Ingeniero", "Ventas"), usa "categoria".
8. Si pregunta si "tiene empleo", "trabaja actualmente" o "desempleado":
   - Usa el campo 'tieneEmpleo'.
   - Los valores típicos son "Sí" (para tiene empleo) o "No" (para desempleado).
   - Ejemplo: "que tenga empleo" -> { "filters": { "tieneEmpleo": "Sí" } }
   - Ejemplo: "sin trabajo" -> { "filters": { "tieneEmpleo": "No" } }

Estructura del JSON:
{
  "filters": { 
    "municipio": "Monterrey", 
    "edad": { "op": ">", "val": 30 } 
  },
  "keywords": ["React", "liderazgo"],
  "explanation": "Busco candidatos de Monterrey mayores de 30 que mencionen React o liderazgo."
}

Consulta del usuario: "${query}"
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
                console.log(`🔍 [AI Query] Sending to Gemini (${mName})...`);
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
                console.warn(`⚠️ [AI Query] ${mName} failed:`, e.message);
            }
        }

        if (!successModel) {
            throw new Error(`Ningún modelo respondió (probados: ${modelsToTry.join(', ')}). Último error: ${lastError}`);
        }

        const response = await result.response;
        const text = response.text();
        console.log(`🔍 [AI Query] Gemini raw response text:`, text);

        // Limpiar el texto si Gemini devuelve markdown ```json ... ```
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error(`La IA no devolvió un JSON válido. Respuesta: ${text}`);
        }

        const aiResponse = JSON.parse(jsonMatch[0]);
        console.log('🤖 AI Parsed Query:', JSON.stringify(aiResponse, null, 2));

        // 3. Ejecutar la búsqueda en los datos reales
        console.log(`🔍 [AI Query] Searching records...`);
        const { candidates } = await getCandidates(2000, 0); // Traer hasta 2000 para búsqueda profunda

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
                            birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
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

        // A. Aplicar Filtros Inteligentes (Metadatos)
        if (aiResponse.filters && Object.keys(aiResponse.filters).length > 0) {
            filtered = filtered.filter(candidate => {
                return Object.entries(aiResponse.filters).every(([key, criteria]) => {
                    const searchStr = normalizeString(criteria.val || criteria);
                    if (!searchStr) return true;

                    let candidateVal = candidate[key];

                    // Manejo especial de EDAD
                    if (key === 'edad') {
                        candidateVal = calculateAge(candidate.fechaNacimiento);
                    }

                    // Manejo especial de NOMBRES (Robustez: buscar en Real y WhatsApp)
                    if (key === 'nombreReal' || key === 'nombre') {
                        const valReal = normalizeString(candidate.nombreReal);
                        const valWA = normalizeString(candidate.nombre);
                        return valReal.includes(searchStr) || valWA.includes(searchStr);
                    }

                    // APLICAR FILTRO NORMALIZADO
                    const normalizedCandidateVal = normalizeString(candidateVal);

                    // 1. Coincidencia directa en el campo asignado
                    if (normalizedCandidateVal.includes(searchStr)) return true;

                    // 2. FALLBACK GLOBAL: Si no coincide en su campo, buscar en CUALQUIER otra columna
                    // Esto evita errores si la IA asignó mal la columna (ej: Municipio vs Notas)
                    const matchesAnyField = Object.entries(candidate).some(([cKey, cVal]) => {
                        // Evitar recursión infinita o campos no-string irrelevantes
                        if (cKey === 'id' || cKey === 'whatsapp') return false;
                        return normalizeString(cVal).includes(searchStr);
                    });

                    if (matchesAnyField) return true;

                    // Si criteria es un objeto con operador { op: ">", val: 40 }
                    if (typeof criteria === 'object' && criteria.op) {
                        const { op, val } = criteria;
                        const numVal = parseFloat(val);
                        const numCand = parseFloat(candidateVal);

                        switch (op) {
                            case '>': return numCand > numVal;
                            case '<': return numCand < numVal;
                            case '>=': return numCand >= numVal;
                            case '<=': return numCand <= numVal;
                        }
                    }

                    return false;
                });
            });
        }

        // B. Búsqueda Profunda (Keywords en Chat + Metadatos)
        if (aiResponse.keywords && aiResponse.keywords.length > 0) {
            const finalResults = [];
            for (const candidate of filtered) {
                // 1. Buscar en metadatos (todos los campos)
                const metadataMatch = Object.values(candidate).some(val =>
                    aiResponse.keywords.some(kw => String(val).toLowerCase().includes(kw.toLowerCase()))
                );

                if (metadataMatch) {
                    finalResults.push(candidate);
                    continue;
                }

                // 2. Buscar en el chat
                const messages = await getMessages(candidate.id);
                const chatText = messages.map(m => m.content).join(' ').toLowerCase();

                const chatMatch = aiResponse.keywords.some(kw => chatText.includes(kw.toLowerCase()));

                if (chatMatch) {
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
