import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, updateCandidate, getMessages, recordAITelemetry } from './storage.js';
import { detectGender, cleanNameWithAI, cleanMunicipioWithAI, cleanCategoryWithAI, cleanEmploymentStatusWithAI, cleanDateWithAI, cleanEscolaridadWithAI } from './ai.js';

/**
 * Intelligent Extractor v1.0
 * Uses LLM to parse conversation history into structured candidate data.
 */
export async function intelligentExtract(candidateId, historyText) {
    if (!candidateId || !historyText) return null;

    try {
        const redis = getRedisClient();
        let apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.geminiApiKey;
            }
        }

        if (!apiKey) {
            console.warn('⚠️ No API Key for Intelligent Extraction');
            return null;
        }

        // Sanitize API Key
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = [
            "gemini-1.5-flash",
            "gemini-2.0-flash",
            "gemini-2.0-flash-exp",
            "gemini-pro"
        ];

        // 1. Fetch Dynamic Rules from Redis
        const redisRules = await (redis ? redis.get('automation_rules') : null);
        let rules = redisRules ? JSON.parse(redisRules).filter(r => r.enabled) : [];


        // STEEL-VESSEL FALLBACK: If no rules are found, use hardcoded core rules 
        // to prevent data loss in case of empty configuration.
        if (rules.length === 0) {
            const DEFAULT_FIELDS = [
                { value: 'nombreReal', label: 'Nombre Real' },
                { value: 'fechaNacimiento', label: 'Fecha Nacimiento' },
                { value: 'municipio', label: 'Municipio' },
                { value: 'categoria', label: 'Categoría' },
                { value: 'tieneEmpleo', label: 'Tiene empleo' },
                { value: 'escolaridad', label: 'Escolaridad' }
            ];

            let customFields = [];
            try {
                const customFieldsJson = await redis.get('custom_fields');
                if (customFieldsJson) customFields = JSON.parse(customFieldsJson);
            } catch (e) {
                console.warn('Error fetching custom fields for fallback:', e);
            }

            const allFields = [...DEFAULT_FIELDS, ...customFields];
            const uniqueFields = Array.from(new Map(allFields.map(item => [item.value, item])).values());

            rules = uniqueFields.map(f => ({
                id: `vessel_${f.value}`,
                field: f.value,
                fieldLabel: f.label,
                prompt: `Extrae el valor para el campo "${f.label}".`
            }));
        }

        // 2. Fetch Valid Categories for better mapping
        let categoriesList = "";
        try {
            const categoriesData = await redis?.get('candidatic_categories');
            if (categoriesData) {
                const cats = JSON.parse(categoriesData).map(c => c.name);
                categoriesList = `\n[CATEGORÍAS VÁLIDAS EN EL SISTEMA]: ${cats.join(', ')}`;
            }
        } catch (e) { console.warn('Error fetching categories for extractor:', e); }

        // 3. Build Dynamic Schema and Instructions
        const schema = {
            thought_process: "Paragraph explaining the reasoning behind the extraction",
            conceptual_summary: "A brief, 1-sentence density summary of the candidate's skills, attitude, and tools mentioned (e.g., 'Experienced welder using TIG, mentions high availability but lacks formal cert.')",
            data: {}
        };
        let extractionInstructions = "";

        rules.forEach(rule => {
            schema.data[rule.field] = {
                value: "string | null",
                citation: "Short snippet of text from the chat as evidence"
            };
            extractionInstructions += `- ${rule.fieldLabel || rule.field}: ${rule.prompt || `Extrae el valor para ${rule.fieldLabel}`}\n`;
        });

        const prompt = `[VIPER-GRIP REASONING PROTOCOL v2.1]
Analiza exhaustivamente la conversación para extraer datos del Candidato usando Razonamiento Lógico (Chain of Thought).

CONVERSACIÓN HISTÓRICA:
"""
${historyText}
"""
${categoriesList}

REQUERIMIENTOS:
${extractionInstructions}

ESTRATEGIA DE RAZONAMIENTO (MÉTODO GOOGLE/ANTIGRAVITY):
1. PENSAMIENTO (thought_process): Antes de extraer, escribe un análisis breve. 
   - REGLA CRÍTICA DE CATEGORÍA: Si el usuario menciona "Ayudante" (aunque sea en un almacén), la categoría DEBE ser "Ayudante". Solo usa "Almacenista" si el usuario se describe puramente como tal sin mencionar "Ayudante".
   - MAPPING: Intenta que la categoría coincida con las [CATEGORÍAS VÁLIDAS] si están listadas arriba.
2. CITACIÓN: Para cada dato extraído, DEBES incluir el fragmento de texto exacto donde el candidato lo mencionó. Si no hay evidencia clara, el valor debe ser null.
3. PRECISIÓN: Si el dato NO está en la charla, devuelve null. PROHIBIDO alucinar.
4. EXTRACCIÓN DE NOMBRE: El "nombreReal" debe venir de lo que el CANDIDATO escribió.

Responde ÚNICAMENTE con un JSON puro que siga este esquema:
${JSON.stringify(schema, null, 2)}
`;

        let jsonText = '';
        for (const mName of modelsToTry) {
            try {
                const startTime = Date.now();
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: {
                        temperature: 0.1,
                    }
                });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                jsonText = response.text();

                // Telemetry
                recordAITelemetry({
                    model: mName,
                    latency: Date.now() - startTime,
                    tokens: response.usageMetadata?.totalTokenCount || 0,
                    candidateId: candidateId,
                    action: 'extraction'
                });

                if (jsonText && jsonText.includes('{')) break;
            } catch (err) {
                console.warn(`⚠️ [Viper] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        if (!jsonText) {
            console.error('❌ [Viper] All models failed to extract data.');
            return null;
        }

        // Sanitize JSON response
        jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();

        let extractedEnvelope = {};
        try {
            extractedEnvelope = JSON.parse(jsonText);
        } catch (parseErr) {
            const match = jsonText.match(/\{[\s\S]*\}/);
            if (match) {
                try { extractedEnvelope = JSON.parse(match[0]); } catch (e) { }
            }
        }

        const extracted = extractedEnvelope.data || {};
        const thoughtProcess = extractedEnvelope.thought_process || "No reasoning provided";
        const conceptualSummary = extractedEnvelope.conceptual_summary || "";

        // 3. Process and refine updates
        const updateData = {};

        for (const rule of rules) {
            const fieldResult = extracted[rule.field];
            const val = typeof fieldResult === 'object' ? fieldResult.value : fieldResult;

            if (!val || val === 'null' || val === 'N/A' || val === 'INVALID') continue;


            try {
                if (rule.field === 'nombreReal') {
                    const cleaned = await cleanNameWithAI(val);
                    updateData.nombreReal = cleaned || val; // Fallback to raw if clean fails
                    if (updateData.nombreReal) updateData.genero = await detectGender(updateData.nombreReal);
                } else if (rule.field === 'municipio') {
                    const cleaned = await cleanMunicipioWithAI(val);
                    updateData.municipio = cleaned || val;
                } else if (rule.field === 'categoria') {
                    const cleaned = await cleanCategoryWithAI(val);
                    updateData.categoria = cleaned || val;
                } else if (rule.field === 'tieneEmpleo' || rule.field === 'empleo') {
                    const fieldName = 'tieneEmpleo';
                    if (typeof val === 'boolean') updateData[fieldName] = val ? 'Sí' : 'No';
                    else {
                        const cleaned = await cleanEmploymentStatusWithAI(val);
                        updateData[fieldName] = cleaned || val;
                    }
                } else if (rule.field === 'fechaNacimiento' || rule.field === 'fecha') {
                    const cleaned = await cleanDateWithAI(val);
                    updateData.fechaNacimiento = (cleaned && cleaned !== 'INVALID') ? cleaned : val;
                } else if (rule.field === 'escolaridad') {
                    const cleaned = await cleanEscolaridadWithAI(val);
                    updateData.escolaridad = cleaned || val;
                } else {
                    updateData[rule.field] = val;
                }
            } catch (err) {
                console.warn(`⚠️ [Viper] Error cleaning field ${rule.field}:`, err.message);
                updateData[rule.field] = val; // Always save raw if cleaning crashes
            }
        }

        // Add Conceptual Summary to metadata for high-performance search
        if (conceptualSummary) {
            updateData.chat_summary = conceptualSummary;
        }

        // Apply updates if any
        if (Object.keys(updateData).length > 0) {
            await updateCandidate(candidateId, updateData);

            // IMPACT TRACKING: Did Brenda help recover this data?
            if (redis && (updateData.nombreReal || updateData.municipio)) {
                try {
                    const messages = await getMessages(candidateId);
                    const hadProactive = (messages || []).some(m => m.meta?.proactiveLevel);
                    if (hadProactive) {
                        // Check if we already gave credit for this candidate to avoid double counting
                        const alreadyCounted = await redis.get(`ai:proactive:recovered:${candidateId}`);
                        if (!alreadyCounted) {
                            await redis.incr('ai:proactive:total_recovered');
                            await redis.set(`ai:proactive:recovered:${candidateId}`, '1', 'EX', 30 * 24 * 3600); // 30 days
                        }
                    }
                } catch (e) { console.warn('Error tracking proactive impact:', e); }
            }

            // DIAGNOSTIC LOG (Persistent in Redis)
            if (redis) {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    candidateId,
                    thoughtProcess,
                    extracted,
                    refined: updateData,
                    historySnippet: historyText.substring(0, 500)
                };
                await redis.lpush('debug:extraction_log', JSON.stringify(logEntry));
                await redis.ltrim('debug:extraction_log', 0, 19); // Keep last 20
            }

            return updateData;
        }

        if (redis) {
            await redis.lpush('debug:extraction_log', JSON.stringify({
                timestamp: new Date().toISOString(),
                candidateId,
                status: 'NO_DATA',
                raw: extracted,
                historySnippet: historyText.substring(0, 500)
            }));
            await redis.ltrim('debug:extraction_log', 0, 19);
        }
        return null;

    } catch (error) {
        console.error('❌ [Intelligent Extractor] Error:', error.message);
        return null;
    }
}
