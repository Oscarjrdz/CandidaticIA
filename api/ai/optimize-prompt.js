import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { fieldLabel, rawPrompt } = req.body;
        if (!fieldLabel && !rawPrompt) return res.status(400).json({ success: false, error: 'Field label or Raw Prompt is required' });

        const redis = getRedisClient();
        // ... (API key logic same)
        let apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey && redis) {
            const aiConfigJson = await redis.get('ai_config');
            if (aiConfigJson) {
                const aiConfig = JSON.parse(aiConfigJson);
                apiKey = aiConfig.geminiApiKey;
            }
        }

        if (!apiKey) return res.status(500).json({ success: false, error: 'AI not configured' });

        // Sanitize API Key
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = [
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-2.0-flash-exp",
            "gemini-pro"
        ];

        let systemInstruction = "";
        if (fieldLabel) {
            systemInstruction = `Actúa como un experto en ingeniería de prompts para sistemas de reclutamiento.
Tu objetivo es escribir una instrucción profesional y precisa para que una IA extraiga el valor del campo "${fieldLabel}" de una conversación de WhatsApp.
REGLAS:
1. La instrucción debe ser corta y directa (máximo 15 palabras).
2. Usa verbos de acción.
3. Responde ÚNICAMENTE con la instrucción optimizada.`;
        } else {
            systemInstruction = `Actúa como un experto en ingeniería de prompts para automatizaciones de reclutamiento por WhatsApp.
Tu objetivo es MEJORAR y PROFESIONALIZAR la siguiente instrucción/regla que un usuario ha escrito.
LA REGLA ORIGINAL: "${rawPrompt}"

REGLAS DE OPTIMIZACIÓN:
1. Asegúrate de que la instrucción sea clara para una IA (estilo GPT/Gemini).
2. Mantén la esencia del usuario pero hazla sonar proactiva y natural.
3. Si el usuario pide enviar un mensaje, asegúrate de que el prompt optimizado diga "Si [condición], envía el siguiente mensaje: [mensaje optimizado]".
4. Evita formalismos excesivos. Queremos que parezca un humano escribiendo en WhatsApp.
5. Usa como máximo 40 palabras.
6. Responde ÚNICAMENTE con el prompt optimizado, sin introducciones ni comillas.`;
        }

        const finalPrompt = systemInstruction;

        let optimizedPrompt = '';
        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: mName });
                const result = await model.generateContent(finalPrompt);
                const response = await result.response;
                optimizedPrompt = response.text().trim().replace(/^"|"$/g, '');
                if (optimizedPrompt) break;
            } catch (err) {
                console.warn(`⚠️ [Optimizer] Model ${mName} failed:`, err.message);
                continue;
            }
        }

        if (!optimizedPrompt) {
            console.error('❌ [Optimizer] All models failed.');
            return res.status(500).json({ success: false, error: 'Todos los modelos de IA fallaron. Intenta más tarde.' });
        }

        return res.status(200).json({ success: true, optimizedPrompt });
    } catch (error) {
        console.error('❌ Optimize Prompt Final Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
