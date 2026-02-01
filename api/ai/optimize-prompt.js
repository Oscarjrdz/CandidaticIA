import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Robust body parsing
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { prompt } = body || {};
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

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
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const instruction = `
            Eres un experto en Reclutamiento y Psicología Organizacional. 
            Tu tarea es convertir una instrucción simple de un reclutador en un "System Prompt" optimizado para Brenda, una reclutadora IA que contactará candidatos por WhatsApp.

            REGLAS:
            1. El prompt resultante debe ser en SEGUNDA PERSONA (Como Brenda).
            2. Debe ser amable, profesional pero adaptable.
            3. Debe incluir el uso estratégico de variables: {{Candidato}} y {{Vacante}}.
            4. El tono debe ser humano, no robótico. No uses saludos excesivamente formales si la instrucción es casual.
            5. Mantén la brevedad (máximo 400 caracteres) porque es para WhatsApp.

            INSTRUCCIÓN DEL RECLUTADOR:
            "${prompt}"

            RESPONDE SOLO CON EL PROMPT OPTIMIZADO:
        `;

        const result = await model.generateContent(instruction);
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
