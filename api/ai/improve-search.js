import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required' });

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
        const modelsToTry = ["gemini-1.5-flash", "gemini-2.0-flash"];

        const systemInstructions = `Actúa como un experto en filtrado de talento.
Tu objetivo es transladar una intención de búsqueda simple a una descripción detallada que un sistema de extracción de datos pueda entender mejor.

REGLAS:
1. Sé específico con los criterios de filtrado (edad, ubicación, habilidades).
2. Usa un lenguaje profesional pero directo.
3. El resultado debe ser una sola instrucción de búsqueda mejorada.
4. Responde ÚNICAMENTE con el texto de la búsqueda mejorada, sin explicaciones.

Ejemplo:
Input: "busco gente de 40 años"
Output: "Identifica candidatos masculinos y femeninos que tengan exactamente o alrededor de 40 años de edad, sin importar su ubicación actual."

Input: "arquitectos en apodaca"
Output: "Busca perfiles con formación o experiencia en arquitectura que residan actualmente en el municipio de Apodaca."`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`${systemInstructions}\n\nMejora esta búsqueda: "${prompt}"`);
        const response = await result.response;
        const improvedSearch = response.text().trim().replace(/^"|"$/g, '');

        return res.status(200).json({ success: true, improvedSearch });
    } catch (error) {
        console.error('❌ Improve Search Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
