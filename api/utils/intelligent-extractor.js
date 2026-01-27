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
        const rulesJson = await redis.get('automation_rules');
        const rules = rulesJson ? JSON.parse(rulesJson).filter(r => r.enabled) : [];

        if (rules.length === 0) {
            console.log('ℹ️ [Intelligent Extractor] No enabled rules found.');
            return null;
        }

        // 2. Build Dynamic Schema and Instructions
        const schema = {};
        let extractionInstructions = "";

        rules.forEach(rule => {
            schema[rule.field] = "string | null"; // Default to string or null
            extractionInstructions += `- ${rule.fieldLabel || rule.field}: ${rule.prompt || `Extrae el valor para ${rule.fieldLabel}`}\n`;
        });

        const prompt = `Analiza la siguiente conversación entre un Reclutador AI y un Candidato.
Tu objetivo es extraer información clave para el perfil del candidato basándote en las instrucciones proporcionadas.

CONVERSACIÓN:
\"\"\"
${historyText}
\"\"\"

INSTRUCCIONES DE EXTRACCIÓN:
${extractionInstructions}

REGLAS GENERALES:
1. Extrae solo datos confirmados o mencionados claramente por el candidato.
2. Si un dato no está presente o es incierto, pon null.
3. Para campos de estatus (ej: tiene empleo), responde de forma que sea fácil de entender (ej: "Sí", "No").
4. Para fechas, intenta usar formato DD/MM/YYYY.

Responde ÚNICAMENTE con un objeto JSON que siga este esquema:
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
            } else if (rule.field === 'tieneEmpleo') {
                // Handle different possible extractions for "tieneEmpleo"
                if (typeof val === 'boolean') updateData.tieneEmpleo = val ? 'Sí' : 'No';
                else updateData.tieneEmpleo = await cleanEmploymentStatusWithAI(val);
            } else if (rule.field === 'fechaNacimiento' || rule.field === 'fecha') {
                const cleaned = await cleanDateWithAI(val);
                if (cleaned !== 'INVALID') updateData[rule.field] = cleaned;
            } else {
                // For any other dynamic field, just save the extracted value
                updateData[rule.field] = val;
            }
        }

        // Apply updates if any
        if (Object.keys(updateData).length > 0) {
            console.log(`💾 [Intelligent Extractor] Updating candidate ${candidateId}:`, updateData);
            await updateCandidate(candidateId, updateData);
            return updateData;
        }

        return null;

    } catch (error) {
        console.error('❌ [Intelligent Extractor] Error:', error.message);
        return null;
    }
}
