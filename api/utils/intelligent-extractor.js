import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, updateCandidate, getMessages, recordAITelemetry, getCandidateById } from './storage.js';
import { getSchemaByField } from './schema-registry.js';

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
                citation: "Short snippet of text from the chat as evidence",
                confidence: "0.0 to 1.0 (How sure are you based on the text?)"
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

ESTRATEGIA DE RAZONAMIENTO (PROTOCOLO VIPER 3.1):
1. PENSAMIENTO (thought_process): Analiza quién es el Reclutador (Oscar) y quién es el Candidato. 
   - REGLA CRÍTICA DE NOMBRE: El "nombreReal" NUNCA debe ser un municipio, ciudad o estado (ej. "Escobedo", "Monterrey", "Apodaca"). Si el usuario dice "Soy de Monterrey", Monterrey es el MUNICIPIO, no su nombre.
   - REGLA CRÍTICA DE GÉNERO: Solo extrae datos si el Candidato los dice sobre SÍ MISMO.
   - REGLA DE CATEGORÍA: Si menciona "Ayudante", esa es la categoría principal.
2. CITACIÓN: Incluye el fragmento exacto. Si no hay evidencia, usa null.
3. CONFIDENCIA: Puntaje 0.0 a 1.0.
   - 1.0: "Mi nombre es Juan".
   - 0.5: Inferencia vaga.
   - 0.1: Basura o mensaje del sistema.
4. VALIDACIÓN CRUZADA: No permitas que un municipio se filtre al campo de nombre.
5. EXTRACCIÓN DE NOMBRE: El "nombreReal" debe ser el nombre humano del candidato.

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

        // 3. Smart Reconciliation (Amazon Data Engine Style)
        const currentCandidate = await getCandidateById(candidateId);
        const evidenceLogs = currentCandidate?.data_evidence || {};
        const updateData = {};

        for (const rule of rules) {
            const extractionResult = extracted[rule.field];
            if (!extractionResult) continue;

            const val = typeof extractionResult === 'object' ? extractionResult.value : extractionResult;
            const confidence = parseFloat(extractionResult.confidence || 0);
            const citation = extractionResult.citation || "";

            if (!val || val === 'null' || val === 'N/A' || val === 'INVALID') continue;

            // --- RECONCILIATION LOGIC ---
            const schema = getSchemaByField(rule.field);
            const canonicalField = (schema && schema.canonicalField) ? schema.canonicalField : rule.field;

            const existingVal = currentCandidate ? currentCandidate[canonicalField] : null;
            const isPlaceholder = !existingVal ||
                String(existingVal).toLowerCase().includes('proporcionado') ||
                String(existingVal).toLowerCase() === 'desconocido';

            // ATOMIC DECISION: Should we update?
            // Rule 1: Always update if existing value is a placeholder and confidence > 0.4
            // Rule 2: Only update STABLE data if confidence is very high (> 0.85)
            let shouldUpdate = isPlaceholder ? (confidence > 0.4) : (confidence > 0.85);

            // --- 🛡️ TITAN SHIELD: CROSS-FIELD EXCLUSION ---
            // If the field is 'nombreReal', perform additional sanity checks
            if (canonicalField === 'nombreReal' && val) {
                const lowerVal = val.toLowerCase().trim();
                const otherExtractedMunicipio = extracted.municipio ? (typeof extracted.municipio === 'object' ? String(extracted.municipio.value).toLowerCase() : String(extracted.municipio).toLowerCase()) : '';

                // 1. If the value is the SAME as the extracted municipality, it's likely a mis-mapping
                if (lowerVal === otherExtractedMunicipio && confidence < 0.95) {
                    console.warn(`[ViperShield] Blocked Name-Municipio collision: "${val}"`);
                    shouldUpdate = false;
                }

                // 2. If we already have a high-confidence name, don't change it for something that looks like 1 word (could be a location)
                if (!isPlaceholder && val.split(' ').length === 1 && confidence < 0.9) {
                    shouldUpdate = false;
                }
            }
            // ---------------------------------------------

            if (shouldUpdate) {
                try {
                    let finalVal = val;

                    // Apply Standard Cleaners if present in Registry
                    if (schema && schema.cleaner) {
                        const cleaned = await schema.cleaner(val);
                        finalVal = cleaned || val;
                    }

                    updateData[canonicalField] = finalVal;

                    // Track Evidence (Lineage)
                    evidenceLogs[canonicalField] = {
                        source: 'ai_extraction',
                        citation,
                        confidence,
                        timestamp: new Date().toISOString()
                    };

                    // Trigger Secondary Effects (e.g., gender detection)
                    if (schema && schema.onSuccess) {
                        await schema.onSuccess(finalVal, updateData);
                    }
                } catch (err) {
                    console.warn(`⚠️ [AmazonPipeline] Error reconciling ${rule.field}:`, err.message);
                    updateData[canonicalField] = val; // Fallback to raw
                }
            } else if (existingVal && confidence > 0) {
                console.log(`[AmazonPipeline] Rejected update for ${canonicalField} (Confidence: ${confidence} vs High-Quality Existing Data)`);
            }
        }

        // Save evidence back to candidate metadata
        if (Object.keys(evidenceLogs).length > 0) {
            updateData.data_evidence = evidenceLogs;
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
