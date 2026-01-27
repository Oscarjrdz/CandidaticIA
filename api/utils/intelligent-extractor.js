import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, updateCandidate, getMessages } from './storage.js';
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

        console.log(`🔍 [Viper] Rules Found: ${rules.length}${rules.length === 0 ? ' (Using Fallback)' : ''}`);

        // STEEL-VESSEL FALLBACK: If no rules are found, use hardcoded core rules 
        // to prevent data loss in case of empty configuration.
        if (rules.length === 0) {
            console.log('🛡️ [Steel-Vessel] Using Dynamic Fallback Engine...');
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

        // 2. Build Dynamic Schema and Instructions
        const schema = {};
        let extractionInstructions = "";

        rules.forEach(rule => {
            schema[rule.field] = "string | null"; // Default to string or null
            extractionInstructions += `- ${rule.fieldLabel || rule.field}: ${rule.prompt || `Extrae el valor para ${rule.fieldLabel}`}\n`;
        });

        const prompt = `[VIPER-GRIP EXTRACTION PROTOCOL]
Analiza exhaustivamente la conversación para extraer datos del Candidato.

CONVERSACIÓN HISTÓRICA:
"""
${historyText}
"""

REQUERIMIENTOS DE CAPTURA (EXTRAER SIEMPRE):
${extractionInstructions}

ESTRATEGIA VIPER:
1. Sé AGRESIVO: Si el candidato menciona algo que se parece al dato buscado, extráelo.
2. Si el dato fue mencionado antes en la charla pero el candidato no lo repitió, úsalo (Persistencia).
3. Para campos de texto (Nombre, Municipio), límpialos de basura pero mantén la esencia.
4. Para campos binarios (Sí/No), busca confirmaciones implícitas (ej: "trabajo en una tienda" implica Tiene Empleo: Sí).

Responde ÚNICAMENTE con un JSON puro que siga este esquema:
${JSON.stringify(schema, null, 2)}
`;

        let jsonText = '';
        for (const mName of modelsToTry) {
            try {
                console.log(`📡 [Viper] Trying model ${mName}...`);
                const model = genAI.getGenerativeModel({
                    model: mName,
                    generationConfig: {
                        temperature: 0.1,
                        // responseMimeType: "application/json" // Removed for wider compatibility
                    }
                });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                jsonText = response.text();
                if (jsonText && jsonText.includes('{')) break;
            } catch (err) {
                console.warn(`⚠️ [Viper] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        console.log(`📥 [Viper] Raw Response:`, jsonText);

        if (!jsonText) {
            console.error('❌ [Viper] All models failed to extract data.');
            return null;
        }

        // Sanitize JSON response
        jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();

        let extracted = {};
        try {
            extracted = JSON.parse(jsonText);
        } catch (parseErr) {
            const match = jsonText.match(/\{[\s\S]*\}/);
            if (match) {
                try { extracted = JSON.parse(match[0]); } catch (e) { }
            }
        }

        console.log(`🧠 [Viper Extractor] Parsed Data:`, JSON.stringify(extracted));

        // 3. Process and refine updates
        const updateData = {};

        for (const rule of rules) {
            const val = extracted[rule.field];
            if (!val || val === 'null' || val === 'N/A' || val === 'INVALID') continue;

            console.log(`✨ [Viper] Processing Field: ${rule.field} = ${val}`);

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

        // Apply updates if any
        if (Object.keys(updateData).length > 0) {
            console.log(`💾 [Viper] Final Update Data for ${candidateId}:`, updateData);
            await updateCandidate(candidateId, updateData);

            // DIAGNOSTIC LOG (Persistent in Redis)
            if (redis) {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    candidateId,
                    extracted,
                    refined: updateData,
                    historySnippet: historyText.substring(0, 500)
                };
                await redis.lpush('debug:extraction_log', JSON.stringify(logEntry));
                await redis.ltrim('debug:extraction_log', 0, 19); // Keep last 20
            }

            return updateData;
        }

        console.log(`⏹️ [Viper] No data to update for ${candidateId}`);
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
