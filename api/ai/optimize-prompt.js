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
                        3. NO ESCRIBAS EL MENSAJE FINAL. Escribe una ESTRATEGIA de despedida o excusa profesional para Brenda.
                        4. Mantén la brevedad (máximo 300 caracteres).
                        5. Usa un tono humano y cercano.

                        TEXTO ORIGINAL:
                        "${rawPrompt}"

                        RESPONDE SOLO CON EL MENSAJE OPTIMIZADO:
                    `;
                } else {
                    instruction = `
                        Eres un experto en Reclutamiento y Psicología Organizacional. 
                        Tu tarea es convertir una instrucción simple de un reclutador en una "DIRECTIVA SUPREMA" optimizada para Brenda, una reclutadora IA.

                        REGLAS CRÍTICAS:
                        1. NO ESCRIBAS EL MENSAJE FINAL DE WHATSAPP. Escribe la ESTRATEGIA que Brenda debe seguir.
                        2. Brenda debe actuar según tu instrucción. Usa verbos de acción (Pregunta, Explica, Evalúa).
                        3. Si el reclutador menciona "avanzar", "siguiente paso" o "mover", INCLUYE la instrucción de usar el tag [MOVE] si el candidato responde positivamente.
                        4. Usa las variables {{Candidato}} y {{Vacante}} de forma estratégica.
                        5. El tono de la instrucción debe ser profesional y directivo.
                        6. Mantén la brevedad (máximo 450 caracteres).

                        EJEMPLO:
                        In: "pregunta si quiere trabajar y si si muevelo"
                        Out: "Saluda a {{Candidato}} y consulta su interés actual en la posición de {{Vacante}}. Si su respuesta es afirmativa y muestra disponibilidad, utiliza el tag [MOVE] para transferirlo a la siguiente etapa de evaluación."

                        INSTRUCCIÓN DEL RECLUTADOR:
                        "${rawPrompt}"

                        RESPONDE SOLO CON LA DIRECTIVA OPTIMIZADA (SIN MENSAJES DE RELLENO):
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
