import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, updateCandidate, getMessages } from './storage.js';
import { detectGender, cleanNameWithAI, cleanMunicipioWithAI, cleanCategoryWithAI, cleanEmploymentStatusWithAI, cleanDateWithAI } from './ai.js';

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
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        // 1. Fetch Dynamic Rules from Redis
        const rulesJson = await redis ? await redis.get('automation_rules') : null;
        let rules = rulesJson ? JSON.parse(rulesJson).filter(r => r.enabled) : [];

        // STEEL-VESSEL FALLBACK: If no rules are found, use hardcoded core rules 
        // to prevent data loss in case of empty configuration.
        if (rules.length === 0) {
            console.log('ℹ️ [Intelligent Extractor] Empty rules in Redis. Using Steel-Vessel Fallbacks.');
            rules = [
                { id: 'vessel_nombre', field: 'nombreReal', fieldLabel: 'Nombre Real', prompt: 'Captura el nombre real y apellidos del candidato.' },
                { id: 'vessel_fecha', field: 'fechaNacimiento', fieldLabel: 'Fecha Nacimiento', prompt: 'Determina la fecha de nacimiento (DD/MM/YYYY).' },
                { id: 'vessel_mun', field: 'municipio', fieldLabel: 'Municipio', prompt: 'Extrae el municipio o ciudad de residencia.' },
                { id: 'vessel_cat', field: 'categoria', fieldLabel: 'Categoría', prompt: 'Identifica el área o vacante de interés.' },
                { id: 'vessel_emp', field: 'tieneEmpleo', fieldLabel: 'Tiene empleo', prompt: 'Determina si el candidato tiene empleo actualmente (Sí/No).' }
            ];
        }

        // 2. Build Dynamic Schema and Instructions
        const schema = {};
        let extractionInstructions = "";

        rules.forEach(rule => {
            schema[rule.field] = "string | null"; // Default to string or null
            extractionInstructions += `- ${rule.fieldLabel || rule.field}: ${rule.prompt || `Extrae el valor para ${rule.fieldLabel}`}\n`;
        });

        const prompt = `[TITANIUM EXTRACTION PROTOCOL]
Analiza la conversación entre el Reclutador AI y un Candidato para extraer datos estructurados con precisión quirúrgica.

CONVERSACIÓN:
"""
${historyText}
"""

COLUMN DATASHEET (Extraer estos campos):
${extractionInstructions}

ESTRATEGIA DE RAZONAMIENTO (Chain-of-Thought):
1. Identifica el último valor mencionado de forma clara para cada campo.
2. Valida que el dato sea coherente con su descripción técnica.
3. Si un dato no existe absolutamente en la charla, usa null.
4. Para campos binarios (Sí/No), infiere basado en la actitud y afirmaciones del candidato.

REGLAS DE ORO:
- Prohibido inventar datos (Zero Hallucination).
- Formato de fecha estricto: DD/MM/YYYY.

Responde ÚNICAMENTE con un objeto JSON siguiendo este esquema exacto:
${JSON.stringify(schema, null, 2)}
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const jsonText = response.text();
        const extracted = JSON.parse(jsonText);

        console.log(`🧠 [Intelligent Extractor] Dynamic extraction result:`, extracted);

        // 3. Process and refine updates
        const updateData = {};

        for (const rule of rules) {
            const val = extracted[rule.field];
            if (val === null || val === undefined) continue;

            // Apply specific AI cleaning based on common field names (Optional but recommended)
            if (rule.field === 'nombreReal') {
                const cleaned = await cleanNameWithAI(val);
                if (cleaned) {
                    updateData.nombreReal = cleaned;
                    updateData.genero = await detectGender(cleaned);
                }
            } else if (rule.field === 'municipio') {
                updateData.municipio = await cleanMunicipioWithAI(val);
            } else if (rule.field === 'categoria') {
                updateData.categoria = await cleanCategoryWithAI(val);
            } else if (rule.field === 'tieneEmpleo' || rule.field === 'empleo') {
                // Handle different possible extractions for "tieneEmpleo"
                const fieldName = 'tieneEmpleo';
                if (typeof val === 'boolean') updateData[fieldName] = val ? 'Sí' : 'No';
                else updateData[fieldName] = await cleanEmploymentStatusWithAI(val);
            } else if (rule.field === 'fechaNacimiento' || rule.field === 'fecha') {
                const cleaned = await cleanDateWithAI(val);
                if (cleaned !== 'INVALID') updateData.fechaNacimiento = cleaned;
            } else {
                // For any other dynamic field, just save the extracted value
                updateData[rule.field] = val;
            }
        }

        // Apply updates if any
        if (Object.keys(updateData).length > 0) {
            console.log(`💾[Intelligent Extractor] Updating candidate ${candidateId}: `, updateData);
            await updateCandidate(candidateId, updateData);
            return updateData;
        }

        return null;

    } catch (error) {
        console.error('❌ [Intelligent Extractor] Error:', error.message);
        return null;
    }
}
