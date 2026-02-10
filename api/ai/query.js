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

        const systemPrompt = `[ARCHITECTURE PROTOCOL: TITAN SEARCH v3.8]
Eres el Motor de Relevancia UNIVERSAL-ESTRICTO de Candidatic IA. Tu tarea es convertir una consulta de lenguaje natural en un JSON de búsqueda técnica.

[REGLAS DE FILTRADO]:
1. INTENCIÓN SEMÁNTICA: Traduce plurales a singulares para filtros categóricos. Ejemplo: "mujeres" -> {"genero": "Mujer"}.
2. RANGOS NUMÉRICOS (CRÍTICO): Si el usuario pide edades (ej: "20 a 30 años"), usa min y max. 
   - Ejemplo: "de 20 a 30 años" -> {"edad": {"min": 20, "max": 30}}
   - Ejemplo: "más de 30" -> {"edad": {"op": ">", "val": 30}}
3. ESCOLARIDAD (NORMALIZACIÓN): Usa solo estos términos: "Primaria", "Secundaria", "Preparatoria", "Técnica", "Licenciatura", "Posgrado". 
   - Ejemplo: "licenciados" -> {"escolaridad": "Licenciatura"}.
4. KEYWORDS: Solo para habilidades técnicas (ej: "excel") o rasgos psicológicos.

[FORMATO DE SALIDA]:
{
  "filters": { 
    "municipio": "Monterrey", 
    "genero": "Mujer",
    "escolaridad": "Licenciatura",
    "edad": { "min": 20, "max": 30 } 
  },
  "keywords": ["ventas"],
  "explanation": "Búsqueda estricta de mujeres licenciadas de Monterrey entre 20 y 30 años."
}

[BASE DE DATOS]:
${allFields.map(f => `- ${f.value} (${f.label})`).join('\n')}

Consulta del usuario: "${query}"
`;

        // Intentar varios modelos hasta que uno funcione
        const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash"];
        let result;
        let successModel = '';
        let lastError = '';

        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: {
                        temperature: 0.1,
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
            throw new Error(`Ningún modelo respondió. Último error: ${lastError}`);
        }

        const aiResponseRaw = (await result.response).text();
        const jsonMatch = aiResponseRaw.match(/\{[\s\S]*\}/);
        const aiResponse = JSON.parse(jsonMatch[0]);

        // 3. Ejecutar la búsqueda en los datos reales (TODOS)
        const { candidates } = await getCandidates(10000, 0, '', false);

        // --- HELPERS DE FILTRADO ---
        const normalize = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        const calculateAge = (dob) => {
            if (!dob) return null;
            let birthDate = new Date(dob);
            if (isNaN(birthDate.getTime())) {
                const cleanDob = String(dob).toLowerCase().trim();
                const deRegex = /(\d{1,2})\s+de\s+([a-z0-9áéíóú]+)\s+de\s+(\d{4})/;
                const match = cleanDob.match(deRegex);
                if (match) {
                    const day = parseInt(match[1]);
                    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                    const monthIndex = months.findIndex(m => m.startsWith(match[2].slice(0, 3)));
                    if (monthIndex >= 0) birthDate = new Date(parseInt(match[3]), monthIndex, day);
                }
            }
            if (isNaN(birthDate.getTime())) return null;
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
            return age;
        };

        const matchesCriteria = (candidateVal, criteria) => {
            if (criteria === undefined || criteria === null || criteria === '') return true;

            // 1. Rango (min/max)
            if (criteria.min !== undefined || criteria.max !== undefined) {
                const val = Number(candidateVal);
                if (isNaN(val)) return false;
                if (criteria.min !== undefined && val < criteria.min) return false;
                if (criteria.max !== undefined && val > criteria.max) return false;
                return true;
            }

            // 2. Operador (op/val)
            if (criteria.op && criteria.val !== undefined) {
                const val = Number(candidateVal);
                const target = Number(criteria.val);
                if (isNaN(val) || isNaN(target)) return false;
                switch (criteria.op) {
                    case '>': return val > target;
                    case '<': return val < target;
                    case '>=': return val >= target;
                    case '<=': return val <= target;
                    case '=': return val === target;
                    default: return false;
                }
            }

            // 3. String match (Categorical Strict)
            const cStr = normalize(candidateVal);
            const sStr = normalize(criteria.val || criteria);

            if (!cStr || cStr === 'no proporcionado' || cStr === 'n/a' || cStr === 'na') return false;

            return cStr.includes(sStr);
        };

        // --- SCORING ENGINE (TITAN v4.0 - Inclusive Edition) ---
        const activeFilterKeys = Object.keys(aiResponse.filters || {});

        // Final results collection
        let filtered = candidates.reduce((acc, candidate) => {
            let score = 0;
            let matchesCount = 0;
            let totalFiltersApplied = activeFilterKeys.length;
            let mismatchFound = false;

            const candidateAge = calculateAge(candidate.fechaNacimiento);

            // 1. Universal Mandatory Filtering
            activeFilterKeys.forEach(key => {
                const criteria = aiResponse.filters[key];
                const val = (key === 'edad') ? candidateAge : candidate[key];

                // Check for a hard mismatch (only if value exists)
                const cStr = normalize(val);
                const sStr = normalize(criteria.val || criteria);

                // Check for missing data
                const isMissing = !cStr || ['no proporcionado', 'n/a', 'na', 'null', 'undefined'].includes(cStr);

                if (isMissing) {
                    // MISSING DATA: No points, but NOT a failure. This allows candidates with partial profiles to stay.
                    score += 0;
                } else {
                    const hasMatch = matchesCriteria(val, criteria);
                    if (hasMatch) {
                        matchesCount++;
                        score += 100; // Base match points
                    } else {
                        // HARD MISMATCH: If values exist and don't match, this is a real fail.
                        mismatchFound = true;
                    }
                }
            });

            // If we found a clear mismatch (e.g. asked for Monterrey, lives in Apodaca), we skip.
            if (mismatchFound) return acc;

            // 2. Bonus Exponencial por Multi-Filtro (The "AND" effect)
            if (matchesCount > 1) {
                score *= (1 + (matchesCount / totalFiltersApplied));
            }

            // 3. Keywords Relevance (Additive)
            if (aiResponse.keywords && aiResponse.keywords.length > 0) {
                const metadata = normalize(Object.values(candidate).join(' '));
                const summary = normalize(candidate.chat_summary || '');

                aiResponse.keywords.forEach(kw => {
                    const normalizedKw = normalize(kw);
                    if (metadata.includes(normalizedKw)) score += 50;
                    if (summary.includes(normalizedKw)) score += 30;
                });
            }

            // 4. Default Base Score (to ensure they appear if searched)
            if (totalFiltersApplied === 0) score = 10;

            // Push to results if they have some relevance or we are doing a general search
            if (score > 0 || totalFiltersApplied === 0) {
                acc.push({ ...candidate, _relevance: Math.round(score), edad: candidateAge });
            }

            return acc;
        }, []);

        // 5. Sort & Cap (Expanded Limit to 500)
        filtered = filtered.sort((a, b) => b._relevance - a._relevance);

        const limit = parseInt(req.query.limit || 5000);

        return res.status(200).json({
            success: true,
            count: filtered.length,
            version: "Titan 3.8 (Universal Strict)",
            candidates: filtered.slice(0, limit),
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
