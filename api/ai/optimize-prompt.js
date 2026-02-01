import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Robust body parsing
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { prompt: rawPrompt, type = 'instruction' } = body || {};
        if (!rawPrompt) return res.status(400).json({ error: 'Prompt is required' });

        // Logic to get API Key (Env or Redis)
        const { getRedisClient } = await import('../utils/storage.js');
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
            return res.status(500).json({ success: false, error: 'GEMINI_API_KEY_MISSING' });
        }

        // Sanitization
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const matchToken = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (matchToken) apiKey = matchToken[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];

        let result;
        let lastError = '';

        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: mName });
                let instruction = '';

                if (type === 'wait') {
                    instruction = `
                        Eres un experto en Reclutamiento. 
                        Tu tarea es optimizar un "Mensaje de Espera" (Tapón Inteligente) para WhatsApp.
                        Este mensaje se envía cuando el proceso de selección está en pausa o esperando revisión humana.

                        REGLAS:
                        1. Sé sumamente amable y profesional.
                        2. Agradece la paciencia.
                        3. Explica que el equipo está revisando el perfil.
                        4. Mantén la brevedad (máximo 250 caracteres).
                        5. Usa un tono humano y cercano.

                        TEXTO ORIGINAL:
                        "${rawPrompt}"

                        RESPONDE SOLO CON EL MENSAJE OPTIMIZADO:
                    `;
                } else {
                    instruction = `
                        Eres un experto en Reclutamiento y Psicología Organizacional. 
                        Tu tarea es convertir una instrucción simple de un reclutador en un "System Prompt" optimizado para Brenda, una reclutadora IA.

                        REGLAS:
                        1. El prompt resultante debe ser en SEGUNDA PERSONA (Como Brenda).
                        2. Debe ser amable, profesional pero adaptable.
                        3. Debe incluir el uso estratégico de variables: {{Candidato}} y {{Vacante}}.
                        4. El tono debe ser humano.
                        5. Máximo 400 caracteres.

                        INSTRUCCIÓN DEL RECLUTADOR:
                        "${rawPrompt}"

                        RESPONDE SOLO CON EL PROMPT OPTIMIZADO:
                    `;
                }

                result = await model.generateContent(instruction);
                if (result) break;
            } catch (err) {
                console.warn(`Fallback: ${mName} failed:`, err.message);
                lastError = err.message;
            }
        }

        if (!result) {
            return res.status(500).json({ success: false, error: `Error de IA: ${lastError}` });
        }

        const optimizedPrompt = result.response.text().trim();

        return res.status(200).json({
            success: true,
            optimizedPrompt
        });

    } catch (error) {
        console.error('Error optimizing prompt:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
