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

        console.log(`🔍 [Viper] Rules Found: ${rules.length}${rules.length === 0 ? ' (Using Fallback)' : ''}`);

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

        console.log(`📡 [Viper] Sending to LLM (${historyText.length} chars)...`);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonText = response.text();

        console.log(`📥 [Viper] Raw Response:`, jsonText);

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
            return updateData;
        }

        console.log(`⏹️ [Viper] No data to update for ${candidateId}`);
        return null;

    } catch (error) {
        console.error('❌ [Intelligent Extractor] Error:', error.message);
        return null;
    }
}
