import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient } from '../utils/storage.js';

/**
 * Assistant 2.0 Intent Classifier
 * Determines the primary intent of a user message to decide Brenda's response strategy.
 */
export async function classifyIntent(candidateId, lastMessage, historyText = "") {
    if (!lastMessage) return 'UNKNOWN';

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

        if (!apiKey) return 'UNKNOWN';

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: { temperature: 0.1 }
        });

        const prompt = `[INTENT CLASSIFIER v2.0]
Analiza el último mensaje del usuario y el contexto para clasificarlo en una INTENCIÓN.

CATEGORÍAS:
1. ATTENTION: Saludos cortos, llamados de atención o inicio de contacto.
   - Ejemplos: "Oye", "Hola", "Brenda", "Toño", "¿Estás ahí?", "Ey".
2. SMALL_TALK: Socialización, piropos, bromas o preguntas personales.
   - Ejemplos: "Qué guapa", "Jajaja", "¿Cómo estás?", "Eres muy amable".
3. DATA_GIVE: Entrega de información personal o profesional.
   - Ejemplos: "Vivo en Mty", "Me llamo Juan", "Tengo 20 años".
4. QUERY: Preguntas sobre vacantes, sueldos, procesos o dudas técnicas.
   - Ejemplos: "¿Hay vacantes?", "¿Cuánto pagan?", "¿Cómo va mi proceso?".
5. CLOSURE: Agradecimientos, confirmaciones cortas o despedidas.
   - Ejemplos: "Gracias", "Ok", "Muy bien", "Adiós", "Gracias Brenda".

ULTIMO MENSAJE: "${lastMessage}"
CONTEXTO:
${historyText.substring(0, 300)}

Responde ÚNICAMENTE con el nombre de la categoría en MAYÚSCULAS.
Respuesta:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().toUpperCase();

        console.log(`[Intent Classifier] Raw LLM Response: "${text}"`);

        if (text.includes('ATTENTION')) return 'ATTENTION';
        if (text.includes('SMALL_TALK')) return 'SMALL_TALK';
        if (text.includes('DATA_GIVE')) return 'DATA_GIVE';
        if (text.includes('QUERY')) return 'QUERY';
        if (text.includes('CLOSURE')) return 'CLOSURE';

        return 'UNKNOWN';

    } catch (error) {
        console.error('❌ [Intent Classifier] Error:', error);
        return 'UNKNOWN';
    }
}
