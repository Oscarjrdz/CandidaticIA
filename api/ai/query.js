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

        // 3. Ejecutar la búsqueda en los datos reales
        const { candidates } = await getCandidates(2000, 0, '', true); // Exclude linked candidates for AI search

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
                        if (candidateVal === null) return false; // Strict: if filtering by age and no age, exclude.
                    }

                    // APLICAR FILTRO NORMALIZADO
                    // Prioridad 1: Logica Matemática (Si criteria es objeto con op)
                    if (typeof criteria === 'object' && criteria.op) {
                        const { op, val } = criteria;
                        const numVal = parseFloat(val);
                        const numCand = parseFloat(candidateVal);

                        if (isNaN(numCand)) return false; // If value is not a number, strict fail

                        switch (op) {
                            case '>': return numCand > numVal;
                            case '<': return numCand < numVal;
                            case '>=': return numCand >= numVal;
                            case '<=': return numCand <= numVal;
                            case '==': return numCand == numVal;
                            // Add range support if needed in future
                            default: return false;
                        }
                    }

                    // Prioridad 2: Coincidencia de Texto (Fuzzy pero específico a la columna)
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

                    // 2. FALLBACK GLOBAL: Only if the IA specifically didn't target a field (less common now)
                    // or as a very last resort if we want fuzzy matching.
                    // For now, let's keep it strict if a key was assigned.
                    if (candidateVal && normalizedCandidateVal.includes(searchStr)) return true;

                    return false;

                    return false;
                });
            });
        }

        // B. Búsqueda Profunda (Titan Search Phase 1: Indexed Keywords)
        if (aiResponse.keywords && aiResponse.keywords.length > 0) {
            const finalResults = [];
            const keywordsLower = aiResponse.keywords.map(kw => kw.toLowerCase());

            for (const candidate of filtered) {
                // 🛠️ Optimization 1: Check Metadata (Fastest)
                const metadataValues = Object.values(candidate).map(v => String(v).toLowerCase());
                const metadataMatch = keywordsLower.some(kw =>
                    metadataValues.some(val => val.includes(kw))
                );

                if (metadataMatch) {
                    finalResults.push(candidate);
                    continue;
                }

                // 🛠️ Optimization 2: Check Chat Summary (Titan Index - Medium)
                if (candidate.chat_summary) {
                    const summaryMatch = keywordsLower.some(kw =>
                        candidate.chat_summary.toLowerCase().includes(kw)
                    );
                    if (summaryMatch) {
                        finalResults.push(candidate);
                        continue;
                    }
                }

                // 🛠️ Optimization 3: Deep Message Scan (Safety Fallback - Slowest)
                // Only do this if we haven't found a match yet and the candidate has messages
                const messages = await getMessages(candidate.id, 50);
                const userChatText = messages
                    .filter(m => m.from === 'user')
                    .map(m => m.content)
                    .join(' ')
                    .toLowerCase();

                const chatMatch = keywordsLower.some(kw => userChatText.includes(kw));

                if (chatMatch) {
                    finalResults.push(candidate);
                }
            }
            filtered = finalResults;
        }

        return res.status(200).json({
            success: true,
            count: filtered.length,
            version: "Titan 2.1",
            candidates: filtered.map(c => ({
                ...c,
                edad: calculateAge(c.fechaNacimiento)
            })),
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
