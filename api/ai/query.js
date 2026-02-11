import { GoogleGenerativeAI } from "@google/generative-ai";

// --- HELPERS DE FILTRADO (Global Scope) ---
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
            { value: 'edad', label: 'Edad (Número)' },
            { value: 'municipio', label: 'Municipio' },
            { value: 'categoria', label: 'Categoría' },
            { value: 'tieneEmpleo', label: 'Tiene empleo' },
            { value: 'nombre', label: 'Nombre de WhatsApp' },
            { value: 'whatsapp', label: 'Teléfono/WhatsApp' },
            { value: 'statusAudit', label: 'Estado del registro (completos/pendientes)' }
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

        const systemPrompt = `[ARCHITECTURE PROTOCOL: TITAN SEARCH v8.6 - MATHEMATICAL PRECISION]
Eres el Motor de Traducción de Intenciones de Candidatic IA. Tu misión es convertir lenguaje natural en filtros técnicos INVIOLABLES.

[REGLAS DE FILTRADO]:
1. statusAudit (ESTRICTO): 
   - SIEMPRE usa esto para intención de completitud.
   - "completos", "ya terminaron", "registrados", "listos" -> {"statusAudit": "complete"}.
   - "pendientes", "faltan", "no han terminado", "incompletos" -> {"statusAudit": "pending"}.
2. GENERO (ESTRICTO):
   - NUNCA pongas "mujer" o "hombre" en keywords.
   - "mujeres", "damas", "chicas" -> {"genero": "Mujer"}.
   - "hombres", "caballeros", "chicos" -> {"genero": "Hombre"}.
3. EDAD (ESTRICTO - MATEMÁTICO): 
   - SIEMPRE usa el campo "edad".
   - IGUALDAD: "tiene 25" -> {"edad": 25}.
   - OPERADORES: "mayores de 40", "más de 40", "> 40" -> {"edad": {"op": ">", "val": 40}}.
   - OPERADORES: "menores de 20", "menos de 20", "< 20" -> {"edad": {"op": "<", "val": 20}}.
   - RANGOS: "entre 18 y 30", "de 18 a 30" -> {"edad": {"min": 18, "max": 30}}.
   - NUNCA pongas números de edad o términos como "mayores" en keywords.
4. MUNICIPIOS (CRÍTICO): 
   - Si mencionan un lugar (Monterrey, Apodaca, Guadalupe, etc.), ASÍGNALO SIEMPRE al campo "municipio".
   - NUNCA pongas nombres de municipios en keywords.
5. KEYWORDS: Solo para nombres de personas ("Oscar") o habilidades técnicas específicas que no tengan campo.
6. BÚSQUEDA DE FALTANTES: Si el usuario pide específicamente "sin [campo]", usa el valor "$missing". 

[FORMATO DE SALIDA]: JSON JSON JSON. NO TEXTO ADICIONAL.

[BASE DE DATOS DE ATRIBUTOS]:
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
            throw new Error(`Ningún modelo respondió.Último error: ${lastError} `);
        }

        const aiResponseRaw = (await result.response).text();

        // --- ROBUST JSON EXTRACTION ---
        let cleaned = aiResponseRaw.trim();

        // 1. Remove Markdown code blocks if present
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        }

        // 2. Extract balanced JSON object (Prevents trailing noise/braces from breaking parse)
        const startIdx = cleaned.indexOf('{');
        if (startIdx === -1) {
            throw new Error(`AI no devolvió un JSON válido. Raw: ${aiResponseRaw.substring(0, 100)}...`);
        }

        let aiResponse;
        let success = false;

        // Try greedy match first (fastest)
        const greedyMatch = cleaned.match(/\{[\s\S]*\}/);
        if (greedyMatch) {
            try {
                aiResponse = JSON.parse(greedyMatch[0]);
                success = true;
            } catch (e) {
                // If greedy fails (e.g. extra '}'), try manual balanced extraction
                let braceCount = 0;
                let endIdx = -1;
                for (let i = startIdx; i < cleaned.length; i++) {
                    if (cleaned[i] === '{') braceCount++;
                    else if (cleaned[i] === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            endIdx = i;
                            break;
                        }
                    }
                }

                if (endIdx !== -1) {
                    const balancedJson = cleaned.substring(startIdx, endIdx + 1);
                    aiResponse = JSON.parse(balancedJson);
                    success = true;
                }
            }
        }

        if (!success) {
            throw new Error(`Error fatal al parsear respuesta de IA. Raw: ${aiResponseRaw.substring(0, 100)}...`);
        }

        // --- TITAN v8.5 ADVANCED SNIFFER (Intent Protection) ---
        const queryLower = normalize(query);
        const genderTerms = ['hombre', 'hombres', 'caballero', 'caballeros', 'chico', 'chicos'];
        const femaleTerms = ['mujer', 'mujeres', 'dama', 'damas', 'chica', 'chicas'];
        const muniTerms = ['monterrey', 'apodaca', 'guadalupe', 'san nicolas', 'escobedo', 'santa catarina', 'garcia', 'juarez', 'cadereyta', 'san pedro'];

        if (!aiResponse.filters) aiResponse.filters = {};
        if (!aiResponse.keywords) aiResponse.keywords = [];

        // 1. Force Gender Filter (Inclusive Sniffer)
        const hasMale = genderTerms.some(t => queryLower.includes(t));
        const hasFemale = femaleTerms.some(t => queryLower.includes(t));

        if (!aiResponse.filters.genero) {
            if (hasMale && hasFemale) {
                // Multi-gender intent: We do NOT force a strict filter, allowing inclusion of both
                console.log("Inclusive Gender search detected.");
            } else if (hasMale) {
                aiResponse.filters.genero = 'Hombre';
            } else if (hasFemale) {
                aiResponse.filters.genero = 'Mujer';
            }
        }

        // 2. Force Status Audit Filter
        if (!aiResponse.filters.statusAudit) {
            if (['completo', 'listo', 'registrado', 'termino'].some(t => queryLower.includes(t))) aiResponse.filters.statusAudit = 'complete';
            else if (['pendiente', 'falta', 'incompleto'].some(t => queryLower.includes(t))) aiResponse.filters.statusAudit = 'pending';
        }

        // 3. Force Municipality Filter (Sniffer)
        if (!aiResponse.filters.municipio) {
            const foundMuni = muniTerms.find(t => queryLower.includes(t));
            if (foundMuni) aiResponse.filters.municipio = foundMuni;
        }

        // 4. Force Age Filter (Mathematical Sniffer v8.6)
        if (!aiResponse.filters.edad) {
            // "mayores de 40", "mas de 40", "mayor de 40"
            const greaterMatch = queryLower.match(/(?:mayor|mayores|mas) de (\d+)/);
            if (greaterMatch) aiResponse.filters.edad = { op: '>', val: parseInt(greaterMatch[1]) };

            // "menores de 20", "menos de 20", "menor de 20"
            const lowerMatch = queryLower.match(/(?:menor|menores|menos) de (\d+)/);
            if (lowerMatch) aiResponse.filters.edad = { op: '<', val: parseInt(lowerMatch[1]) };

            // "entre 18 y 30"
            const rangeMatch = queryLower.match(/entre (\d+) y (\d+)/);
            if (rangeMatch) aiResponse.filters.edad = { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
        }

        // 5. Keyword Blacklist (Categorical cleanup)
        const blacklist = [...genderTerms, ...femaleTerms, ...muniTerms, 'completo', 'pendientes', 'listos', 'faltan', 'mayor', 'menor', 'años'];
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

            const candidateAge = calculateAge(candidate.fechaNacimiento);

            // 1. Universal Mandatory Filtering
            activeFilterKeys.forEach(key => {
                const criteria = aiResponse.filters[key];
                const val = (key === 'edad') ? candidateAge : candidate[key];

                const cStr = normalize(val);
                const isTargetMissing = criteria === "$missing";

                // --- NOISE DETECTION (Logical Missing) ---
                const isNumeric = typeof val === 'number' || (val && !isNaN(val) && String(val).trim() !== '');
                const noiseList = ['proporcionado', 'n/a', 'na', 'null', 'undefined', 'general', 'sin nombre', 'sin apellido'];
                const isMissing = !isNumeric && (!cStr || noiseList.some(noise => cStr === noise || cStr.includes("no " + noise)) || cStr.length < 2);

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
            version: "Titan 8.6 (Mathematical Precision)",
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
