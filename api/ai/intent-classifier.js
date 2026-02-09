import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient } from '../utils/storage.js';
import { getCachedConfig } from '../utils/cache.js';
import { FEATURES } from '../utils/feature-flags.js';

/**
 * Assistant 2.0 Intent Classifier
 * Determines the primary intent of a user message to decide Brenda's response strategy.
 */
export async function classifyIntent(candidateId, lastMessage, historyText = "", isAudio = false) {
    if (!lastMessage && !isAudio) return 'UNKNOWN';

    try {
        const redis = getRedisClient();
        let apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey && redis) {
            // Use cache if feature flag enabled, otherwise direct Redis
            const aiConfigJson = FEATURES.USE_BACKEND_CACHE
                ? await getCachedConfig(redis, 'ai_config')
                : await redis.get('ai_config');

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

        const prompt = `[INTENT CLASSIFIER v2.1]
Analiza el último mensaje del usuario y el contexto para clasificarlo en una INTENCIÓN.

CATEGORÍAS:
1. AUDIO_INTERACTION: El usuario envió un mensaje de voz o audio. Esta categoría tiene máxima prioridad si se detecta audio.
2. ATTENTION: Saludos cortos, llamados de atención o inicio de contacto por texto.
   - Ejemplos: "Oye", "Hola", "Brenda", "Toño", "¿Estás ahí?", "Ey".
3. SMALL_TALK: Socialización, piropos, bromas o preguntas personales por texto.
   - Ejemplos: "Qué guapa", "Jajaja", "¿Cómo estás?", "Eres muy amable".
4. DATA_GIVE: Entrega de información personal o profesional por texto.
   - Ejemplos: "Vivo en Mty", "Me llamo Juan", "Tengo 20 años".
5. QUERY: Preguntas sobre vacantes, sueldos, procesos o dudas técnicas por texto.
   - Ejemplos: "¿Hay vacantes?", "¿Cuánto pagan?", "¿Cómo va mi proceso?".
6. CLOSURE: Despedidas, agradecimientos finales, confirmaciones de cierre.
   - Ejemplos: "Gracias", "Ok", "Muy bien", "Adiós", "Hasta luego", "Bye", "Nos vemos", "Chao", "Bueno gracias", "Vale", "Perfecto", "Entendido", "Hasta pronto", "Cuídate", "Saludos".

DATOS DE ENTRADA:
- ¿ES AUDIO?: ${isAudio ? 'SÍ' : 'NO'}
- ULTIMO MENSAJE (TEXTO): "${lastMessage}"
- CONTEXTO:
${historyText.substring(0, 300)}

Responde ÚNICAMENTE con el nombre de la categoría en MAYÚSCULAS. Si sabes que es audio, prioriza AUDIO_INTERACTION.
Respuesta:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().toUpperCase();

        console.log(`[Intent Classifier] Raw LLM Response: "${text}" (IsAudio: ${isAudio})`);

        if (isAudio || text.includes('AUDIO_INTERACTION')) return 'AUDIO_INTERACTION';
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
