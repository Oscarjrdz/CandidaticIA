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
Analiza el último mensaje del usuario y clasifícalo en una de las siguientes INTENCIONES:

1. ATTENTION: El usuario solo busca llamar la atención o iniciar contacto (ej: "Oye", "Ey", "Hola", "Brenda", "Toño").
2. SMALL_TALK: Plática social, bromas, halagos, o preguntas personales fuera de lo laboral.
3. DATA_GIVE: El usuario está proporcionando un dato específico (Nombre, Municipio, Escolaridad, etc.).
4. QUERY: El usuario tiene una duda técnica o pregunta por vacantes, sueldos o el estado de su proceso.
5. CLOSURE: Despedidas o agradecimientos finales (ej: "Gracias", "Ok", "Sale", "Adiós").
6. UNKNOWN: Mensajes ambiguos o no clasificados.

MENSAJE DEL USUARIO: "${lastMessage}"
HISTORIAL RECIENTE (Contexto):
${historyText.substring(0, 500)}

Responde ÚNICAMENTE con el nombre de la categoría en MAYÚSCULAS.
Respuesta:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const intent = response.text().trim().toUpperCase();

        const validIntents = ['ATTENTION', 'SMALL_TALK', 'DATA_GIVE', 'QUERY', 'CLOSURE'];
        return validIntents.includes(intent) ? intent : 'UNKNOWN';

    } catch (error) {
        console.error('❌ [Intent Classifier] Error:', error);
        return 'UNKNOWN';
    }
}
