import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient } from '../utils/storage.js';
import { getCachedConfig } from '../utils/cache.js';
import { FEATURES } from '../utils/feature-flags.js';

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
            model: "gemini-2.0-flash",
            generationConfig: { temperature: 0.7 }
        });

        const prompt = `[INTENT CLASSIFIER v2.3]
Analiza el último mensaje del usuario y el contexto para clasificarlo en una INTENCIÓN.

CATEGORÍAS:
1. ATTENTION: Saludos cortos, llamados de atención o inicio de contacto por texto.
   - Ejemplos: "Oye", "Hola", "Brenda", "Toño", "¿Estás ahí?", "Ey".
2. SMALL_TALK: Socialización, piropos, bromas o preguntas personales por texto.
   - Ejemplos: "Qué guapa", "Jajaja", "¿Cómo estás?", "Eres muy amable".
3. DATA_GIVE: Entrega de información personal o profesional por texto.
   - Ejemplos: "Vivo en Mty", "Me llamo Juan", "Tengo 20 años".
4. QUERY: Preguntas sobre vacantes, sueldos, procesos o dudas técnicas por texto.
   - Ejemplos: "¿Hay vacantes?", "¿Cuánto pagan?", "¿Cómo va mi proceso?".
5. ACCEPTANCE: El candidato ACEPTA la propuesta, vacante o cita que Brenda le ofreció. Puede ser explícito o implícito.
   - Ejemplos directos: "Sí", "Si", "Dale", "Ok", "Claro", "Quiero", "Me interesa", "Perfecto", "Listo", "Sí quiero", "Cuándo sería", "A qué hora", "Cuándo me llaman", "Dónde es", "Cómo le hago", "Me late", "Ándale", "Véngale", "Va", "Bueno", "Está bien", "Me apunto", "Me anoto", "Agéndame", "Cuándo puedo ir", "Mañana puedo", "Hoy puedo", "Acepto", "Sí, ayudante".
   - Ejemplos implícitos: Preguntar detalles logísticos ("¿A qué dirección voy?", "¿Cómo llego?", "¿Cuál es la dirección?") porque implica que ya quiso ir a la entrevista.
6. REJECTION: El candidato rechaza explícitamente la vacante o propuesta actual, o indica que no le conviene.
   - Ejemplos: "No me interesa", "Me queda muy lejos", "Pagan muy poco", "No, gracias", "Paso de esa".
7. PIVOT: El candidato pide explícitamente ver una vacante diferente, sin rechazar la actual de forma negativa.
   - Ejemplos: "Tienes algo de almacen?", "Tienes otra cosa?", "Hay otro puesto?", "No tienes de oficina?", "Me das otras opciones?", "Qué más tienes?", "Puedo ver otra vacante?", "Tienen algo diferente?".
8. CLOSURE: Despedidas, agradecimientos finales, confirmaciones de cierre o frases de cortesía mutua.
   - Ejemplos: "Gracias", "Adiós", "Hasta luego", "Bye", "Nos vemos", "Chao", "Bueno gracias", "Vale", "Hasta pronto", "Cuídate", "Saludos", "Igualmente", "Sale", "Enterado", "Que tengas buen día".

DATOS DE ENTRADA:
- ULTIMO MENSAJE (TEXTO): "${lastMessage}"
- CONTEXTO:
${historyText.slice(-1000)}

REGLA CRÍTICA: Si el contexto muestra que Brenda hizo una pregunta de confirmación (como "¿Te gustaría agendar?", "¿Te interesa?", "¿Cuándo puedes ir?") y el candidato responde con cualquier señal positiva o pregunta logística → clasifica como ACCEPTANCE.

Responde ÚNICAMENTE con el nombre de la categoría en MAYÚSCULAS.
Respuesta:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().toUpperCase();

        console.log(`[Intent Classifier] Raw LLM Response: "${text}"`);

        if (text.includes('ATTENTION')) return 'ATTENTION';
        if (text.includes('SMALL_TALK')) return 'SMALL_TALK';
        if (text.includes('DATA_GIVE')) return 'DATA_GIVE';
        if (text.includes('PIVOT')) return 'PIVOT';
        if (text.includes('QUERY')) return 'QUERY';
        if (text.includes('REJECTION')) return 'REJECTION';
        if (text.includes('CLOSURE')) return 'CLOSURE';

        return 'UNKNOWN';

    } catch (error) {
        console.error('❌ [Intent Classifier] Error:', error);
        return 'UNKNOWN';
    }
}
