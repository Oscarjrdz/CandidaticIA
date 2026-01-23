import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { query } = body || {};

        if (!query) {
            return res.status(400).json({ error: 'Falta descripción del candidato' });
        }

        // DYNAMIC IMPORTS
        const { getRedisClient, getCandidates, getMessages } = await import('../../utils/storage.js');
        const redis = getRedisClient();

        // 1. Resolve API Key
        let apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.geminiApiKey;
            }
        }

        if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
            return res.status(500).json({ error: 'Service unavailable (Config)' });
        }

        // Sanitize Key
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];
        else apiKey = apiKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '').trim();

        // 2. Setup Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        const systemPrompt = `
Eres un experto recrutador. Tu tarea es extraer filtros de búsqueda de una frase natural.
Campos disponibles: nombreReal, fechaNacimiento (para edad), municipio, categoria, tieneEmpleo.

Reglas:
1. Retorna SOLO JSON válido.
2. Estructura: { "filters": { ... }, "keywords": [...] }
3. Si busca edad "mayor a X", usa { "edad": { "op": ">", "val": X } }.
4. Si busca "empleado" o "con trabajo", usa { "tieneEmpleo": "Sí" }.
5. "Sin trabajo" -> { "tieneEmpleo": "No" }.

Consulta: "${query}"
`;

        const modelsToTry = ["gemini-1.5-flash", "gemini-pro"];
        let result;
        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: mName });
                result = await model.generateContent(systemPrompt);
                break;
            } catch (e) { console.warn(e.message); }
        }

        if (!result) throw new Error("AI Service Busy");

        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid AI Response");

        const aiResponse = JSON.parse(jsonMatch[0]);

        // 3. Search Data
        const candidates = await getCandidates(1000, 0);

        // Helper: Age Calc
        const calculateAge = (dob) => {
            if (!dob) return null;
            let birthDate = new Date(dob);
            if (isNaN(birthDate.getTime())) {
                const parts = String(dob).split(/[/-]/);
                if (parts.length === 3 && parts[2].length === 4) {
                    birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
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

        // Apply Filters
        if (aiResponse.filters) {
            filtered = filtered.filter(candidate => {
                return Object.entries(aiResponse.filters).every(([key, criteria]) => {
                    let val = candidate[key];
                    if (key === 'edad') val = calculateAge(candidate.fechaNacimiento);
                    if (val === undefined || val === null) return false;

                    if (typeof criteria === 'object' && criteria.op) {
                        const numVal = parseFloat(criteria.val);
                        const numCand = parseFloat(val);
                        switch (criteria.op) {
                            case '>': return numCand > numVal;
                            case '<': return numCand < numVal;
                            case '>=': return numCand >= numVal;
                            case '<=': return numCand <= numVal;
                            default: return String(val).toLowerCase().includes(String(criteria.val).toLowerCase());
                        }
                    }
                    return String(val).toLowerCase().includes(String(criteria).toLowerCase());
                });
            });
        }

        // Keyword Search
        if (aiResponse.keywords && aiResponse.keywords.length > 0) {
            const finalResults = [];
            for (const c of filtered) {
                const match = Object.values(c).some(v =>
                    aiResponse.keywords.some(kw => String(v).toLowerCase().includes(kw.toLowerCase()))
                );
                // Note: We skip deep chat search for public API speed/privacy unless critical
                if (match) finalResults.push(c);
            }
            filtered = finalResults;
        }

        // 4. Sanitize Output (Privacy Protection)
        const privacySafePreview = filtered.slice(0, 10).map(c => ({
            role: c.categoria || 'Candidato General',
            location: c.municipio || 'N/A',
            age: calculateAge(c.fechaNacimiento) || 'N/A',
            skills: [c.categoria, c.municipio].filter(Boolean)
        }));

        return res.status(200).json({
            success: true,
            matches_count: filtered.length,
            preview: privacySafePreview,
            search_criteria: aiResponse
        });

    } catch (error) {
        console.error('Public Search Error:', error);
        return res.status(500).json({ error: 'Search failed' });
    }
}
