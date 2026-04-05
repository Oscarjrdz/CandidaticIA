import { getOpenAIResponse } from '../utils/openai.js';

// --- HELPERS DE FILTRADO (Global Scope) ---
const normalize = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const calculateAge = (dob, storedAge) => {
    // 1. Prioritize stored age if valid
    if (storedAge && !isNaN(storedAge) && parseInt(storedAge) > 0) {
        return parseInt(storedAge);
    }

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

    // 1. Numeric Equality (Strict for Age)
    const numCandidate = Number(candidateVal);
    if (typeof criteria === 'number' || (!isNaN(criteria) && typeof criteria !== 'object')) {
        const numTarget = Number(criteria);
        if (isNaN(numCandidate)) return false;
        return numCandidate === numTarget;
    }

    // 2. Rango (min/max)
    if (criteria.min !== undefined || criteria.max !== undefined) {
        if (isNaN(numCandidate)) return false;
        if (criteria.min !== undefined && numCandidate < criteria.min) return false;
        if (criteria.max !== undefined && numCandidate > criteria.max) return false;
        return true;
    }

    // 3. Operador (op/val)
    if (criteria.op && criteria.val !== undefined) {
        const target = Number(criteria.val);
        if (isNaN(numCandidate) || isNaN(target)) return false;
        switch (criteria.op) {
            case '>': return numCandidate > target;
            case '<': return numCandidate < target;
            case '>=': return numCandidate >= target;
            case '<=': return numCandidate <= target;
            case '=': return numCandidate === target;
            default: return false;
        }
    }

    // 4. String match (Categorical Strict)
    const cStr = normalize(candidateVal);
    const sStr = normalize(criteria.val || criteria);

    if (!cStr || cStr === 'no proporcionado' || cStr === 'n/a' || cStr === 'na') return false;

    return cStr.includes(sStr);
};

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

        const { query, excludeLinked = false } = body || {};

        if (!query) {
            return res.status(400).json({ error: 'Falta el parámetro "query"' });
        }

        // DYNAMIC IMPORTS
        const { getRedisClient, getCandidates, getMessages } = await import('../utils/storage.js');
        const redis = getRedisClient();

        let apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.openaiApiKey;
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
            return res.status(500).json({
                error: 'AI no configurada',
                message: 'Falta OPENAI_API_KEY en Vercel o en la configuración de Settings. Por favor verifica que la llave sea válida.'
            });
        }

        const maskedKey = `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}`;

        // 2. Obtener campos disponibles para que la IA sepa qué buscar
        const DEFAULT_FIELDS = [
            { value: 'nombreReal', label: 'Nombre Real' },
            { value: 'genero', label: 'Género' },
            { value: 'fechaNacimiento', label: 'Fecha Nacimiento' },
            { value: 'edad', label: 'Edad (Número)' },
            { value: 'municipio', label: 'Municipio' },
            { value: 'escolaridad', label: 'Nivel educativo / Escolaridad' },
            { value: 'categoria', label: 'Categoría' },
            { value: 'nombre', label: 'Nombre de WhatsApp' },
            { value: 'whatsapp', label: 'Teléfono/WhatsApp' },
            { value: 'statusAudit', label: 'Estado del registro (completos/pendientes)' },
            { value: 'proyecto', label: 'Está en un proyecto (1=Si, 0=No)' }
        ];

        let allFields = [...DEFAULT_FIELDS];
        try {
            const customFieldsJson = await redis.get('custom_fields');
            const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
            allFields = [...DEFAULT_FIELDS, ...customFields];
        } catch (e) {
            console.warn('⚠️ No se pudieron cargar los campos personalizados:', e.message);
        }

        // --- SYSTEM PROMPT DEFINITION ---
        const systemPrompt = `Eres el asistente de reclutamiento "Candidatic AI" (Titan v9.0). Tu única tarea es extraer la intención de búsqueda de candidatos desde lenguaje natural y devolver los parámetros estructurados en formato JSON estricto.

Debes mapear la búsqueda del reclutador a los siguientes campos/filtros posibles:
- "edad": Número exacto (ej. 40), o un objeto relacional (ej. {"min": 20, "max": 40} o {"op": ">=", "val": 30}).
- "genero": "Hombre" o "Mujer".
- "municipio": Ciudad o locación (ej. "Santa Catarina", "Apodaca").
- "escolaridad": "Primaria", "Secundaria", "Preparatoria", "Licenciatura", "Tecnica", "Posgrado".
- "categoria": Sector industrial (ej. "produccion", "almacen", "administrativo").
- "statusAudit": "complete" (si pide perfiles listos/completos) o "pending" (si busca incompletos).

CUALQUIER otra palabra clave importante extraela como un listado en la propiedad "keywords".

FORMATO DE SALIDA REQUERIDO (JSON ESTRUCTURADO Y NADA MÁS):
{
  "filters": {
     // Solo incluye propiedades mencionadas explícitamente en la consulta
  },
  "keywords": [
    // Lista de palabras extra clave, vacía si no hay
  ]
}

IMPORTANTE: Responde SÓLO con el JSON en bruto, sin backticks (\`\`\`) ni marcas de markdown.`;

        // Call AI Model (using OpenAI or Gemini as configured)
        const history = [{ role: 'system', content: systemPrompt }];
        const result = await getOpenAIResponse(history, query, 'gpt-4o-mini', apiKey, { type: 'json_object' });

        if (!result || !result.content) {
            throw new Error(`Ningún modelo respondió.`);
        }

        const aiResponseRaw = result.content;

        // --- ROBUST JSON EXTRACTION ---
        let cleaned = aiResponseRaw.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        }

        const startIdx = cleaned.indexOf('{');
        if (startIdx === -1) {
            throw new Error(`AI no devolvió un JSON válido. Raw: ${aiResponseRaw.substring(0, 100)}...`);
        }

        let aiRaw;
        try {
            aiRaw = JSON.parse(cleaned);
        } catch (e) {
            // Greedy match backup
            const greedyMatch = cleaned.match(/\{[\s\S]*\}/);
            if (greedyMatch) aiRaw = JSON.parse(greedyMatch[0]);
            else throw new Error("JSON parse failure");
        }

        // --- TITAN v9.0 RESPONSE FLATTENING & SNIFFER ---
        const aiResponse = { filters: aiRaw.filters || {}, keywords: aiRaw.keywords || [] };

        // 1. Flatten top-level fields into filters
        const primaryFields = ['edad', 'genero', 'municipio', 'escolaridad', 'statusAudit', 'categoria', 'proyecto'];
        primaryFields.forEach(field => {
            if (aiRaw[field] !== undefined && aiResponse.filters[field] === undefined) {
                aiResponse.filters[field] = aiRaw[field];
            }
        });

        const queryLower = normalize(query);
        const genderTerms = ['hombre', 'hombres', 'caballero', 'caballeros', 'chico', 'chicos'];
        const femaleTerms = ['mujer', 'mujeres', 'dama', 'damas', 'chica', 'chicas'];
        const muniTerms = ['monterrey', 'apodaca', 'guadalupe', 'san nicolas', 'escobedo', 'santa catarina', 'garcia', 'juarez', 'cadereyta', 'san pedro'];
        const educationTerms = ['preparatoria', 'prepa', 'bachillerato', 'secundaria', 'primaria', 'universidad', 'carrera', 'licenciatura', 'ingenieria'];

        // 2. Force Gender Filter (Sniffer)
        const hasMale = genderTerms.some(t => queryLower.includes(t));
        const hasFemale = femaleTerms.some(t => queryLower.includes(t));
        if (!aiResponse.filters.genero) {
            if (hasMale && !hasFemale) aiResponse.filters.genero = 'Hombre';
            else if (hasFemale && !hasMale) aiResponse.filters.genero = 'Mujer';
        }

        // 3. Force Status Audit Filter
        if (!aiResponse.filters.statusAudit) {
            if (['completo', 'listo', 'registrado', 'termino'].some(t => queryLower.includes(t))) aiResponse.filters.statusAudit = 'complete';
            else if (['pendiente', 'falta', 'incompleto'].some(t => queryLower.includes(t))) aiResponse.filters.statusAudit = 'pending';
        }

        // 4. Force Municipality Filter (Sniffer)
        if (!aiResponse.filters.municipio) {
            const foundMuni = muniTerms.find(t => queryLower.includes(t));
            if (foundMuni) aiResponse.filters.municipio = foundMuni;
        }

        // 5. Force Age Filter (Mathematical Sniffer v9.0)
        if (!aiResponse.filters.edad) {
            const exactMatch = queryLower.match(/(?:tengo|tiene|de|edad)\s+(\d{2})\s+(?:años|edad)?/);
            if (exactMatch) aiResponse.filters.edad = parseInt(exactMatch[1]);

            const greaterMatch = queryLower.match(/(?:mayor|mayores|mas) de (\d+)/);
            if (greaterMatch) aiResponse.filters.edad = { op: '>', val: parseInt(greaterMatch[1]) };

            const lowerMatch = queryLower.match(/(?:menor|menores|menos) de (\d+)/);
            if (lowerMatch) aiResponse.filters.edad = { op: '<', val: parseInt(lowerMatch[1]) };

            const rangeMatch = queryLower.match(/entre (\d+) y (\d+)/);
            if (rangeMatch) aiResponse.filters.edad = { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
        }

        // 6. Keyword Blacklist (Categorical cleanup)
        const blacklist = [...genderTerms, ...femaleTerms, ...muniTerms, ...educationTerms, 'completo', 'pendientes', 'listos', 'faltan', 'mayor', 'menor', 'años', 'edad', 'gente', 'personas'];
        aiResponse.keywords = aiResponse.keywords.filter(kw => !blacklist.includes(normalize(kw)));

        // 3. Ejecutar la búsqueda en los datos reales (TODOS)
        const { candidates } = await getCandidates(10000, 0, '', false);

        // --- SCORING ENGINE (TITAN v4.0 - Inclusive Edition) ---
        const activeFilterKeys = Object.keys(aiResponse.filters || {});

        // Final results collection
        let filtered = candidates.reduce((acc, candidate) => {
            let score = 0;
            let matchesCount = 0;
            let totalFiltersApplied = activeFilterKeys.length;
            let mismatchFound = false;

            const candidateAge = calculateAge(candidate.fechaNacimiento, candidate.edad);

            // 1. Universal Mandatory Filtering
            activeFilterKeys.forEach(key => {
                const criteria = aiResponse.filters[key];
                const val = (key === 'edad') ? candidateAge : candidate[key];

                const cStr = normalize(val);
                const isTargetMissing = criteria === "$missing";

                // --- NOISE DETECTION (Logical Missing) ---
                const isNumeric = typeof val === 'number' && !isNaN(val);
                const noiseList = ['proporcionado', 'n/a', 'na', 'null', 'undefined', 'general', 'sin nombre', 'sin apellido'];
                const isMissing = val === null || val === undefined || (!isNumeric && (!cStr || noiseList.some(noise => cStr === noise || cStr.includes("no " + noise)) || cStr.length < 2));

                if (isMissing) {
                    if (isTargetMissing) {
                        matchesCount++;
                        score += 5000;
                    } else {
                        // TITAN v7.0 NO LEAK: If a filter is present, missing data is EXCLUDED.
                        // This prevents showing the entire DB of "pending" candidates when searching for "Hombres".
                        mismatchFound = true;
                    }
                } else {
                    if (isTargetMissing) {
                        mismatchFound = true;
                    } else {
                        const hasMatch = matchesCriteria(val, criteria);
                        if (hasMatch) {
                            matchesCount++;
                            score += 10000; // Big boost for confirmed matches
                        } else {
                            mismatchFound = true;
                        }
                    }
                }
            });

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

            // 4. Final Validation: "Inclusive" but not "Spammy"
            const hasKeywords = aiResponse.keywords && aiResponse.keywords.length > 0;
            const hasFilters = totalFiltersApplied > 0;

            // If it's a completely empty search (no filters, no keywords), show everything with a base score
            if (!hasFilters && !hasKeywords) {
                score = 10;
            }

            // Push to results if they have some relevance or we are doing a general search
            if (score > 0) {
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
            version: "Titan 8.7 (Zero Leak Pro)",
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
