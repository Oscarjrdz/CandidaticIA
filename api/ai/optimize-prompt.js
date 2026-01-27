import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { fieldLabel } = req.body;
        if (!fieldLabel) return res.status(400).json({ success: false, error: 'Field label is required' });

        const redis = getRedisClient();
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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Actúa como un experto en ingeniería de prompts para sistemas de reclutamiento.
Tu objetivo es escribir una instrucción profesional y precisa para que una IA extraiga el valor del campo "${fieldLabel}" de una conversación de WhatsApp.

REGLAS:
1. La instrucción debe ser corta y directa (máximo 15 palabras).
2. Usa verbos de acción como "Identifica", "Extrae", "Captura", "Determina".
3. Si el campo es ambiguo, asume un contexto de RH.
4. Responde ÚNICAMENTE con la instrucción de captura optimizada, sin comillas ni explicaciones.

Ejemplos:
- Nombre Real -> "Captura el nombre completo y apellidos del candidato."
- Tiene Empleo -> "Determina de forma binaria (Sí/No) si la persona labora actualmente."
- Nivel de Inglés -> "Extrae el nivel de inglés mencionado (Básico/Medio/Avanzado)."

Instrucción optimizada:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const optimizedPrompt = response.text().trim().replace(/^"|"$/g, '');

        return res.status(200).json({ success: true, optimizedPrompt });
    } catch (error) {
        console.error('Optimize Prompt Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
