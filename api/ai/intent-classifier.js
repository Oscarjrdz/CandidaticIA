import axios from 'axios';
import { getRedisClient } from '../utils/storage.js';
import { getCachedConfig } from '../utils/cache.js';
import { FEATURES } from '../utils/feature-flags.js';

/**
 * Assistant 2.0 Intent Classifier (OpenAI Version)
 * Determines the primary intent of a user message.
 */
export async function classifyIntent(candidateId, lastMessage, historyText = "") {
   if (!lastMessage) return 'UNKNOWN';

   try {
      const redis = getRedisClient();
      let apiKey = process.env.OPENAI_API_KEY;

      if (redis) {
         const aiConfigJson = FEATURES.USE_BACKEND_CACHE
            ? await getCachedConfig(redis, 'ai_config')
            : await redis.get('ai_config');

         if (aiConfigJson) {
            const aiConfig = typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson;
            if (aiConfig.openaiApiKey) apiKey = aiConfig.openaiApiKey;
         }
      }

      if (!apiKey) {
         console.warn('[Intent Classifier] ⚠️ No API Key found, skipping classification');
         return 'UNKNOWN';
      }

      const prompt = `[INTENT CLASSIFIER v2.4]
Analiza el último mensaje del usuario y el contexto para clasificarlo en una INTENCIÓN.

CATEGORÍAS:
1. ATTENTION: Saludos cortos, llamados de atención o inicio de contacto.
2. SMALL_TALK: Socialización, piropos, bromas o preguntas personales.
3. DATA_GIVE: Entrega de información personal o profesional.
4. QUERY: Preguntas sobre vacantes, sueldos, procesos o dudas técnicas.
5. ACCEPTANCE: El candidato ACEPTA la propuesta, vacante o cita. Puede ser explícito o implícito (ej: preguntar dirección/horario tras propuesta).
6. REJECTION: El candidato rechaza explícitamente la vacante o propuesta actual.
7. PIVOT: El candidato pide explícitamente ver una vacante diferente.
8. CLOSURE: Despedidas, agradecimientos finales o frases de cortesía.

ULTIMO MENSAJE: "${lastMessage}"
CONTEXTO RECIENTE:
${historyText.slice(-800)}

Responde ÚNICAMENTE con el nombre de la categoría en MAYÚSCULAS.`;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
         model: 'gpt-4o-mini',
         messages: [{ role: 'system', content: prompt }],
         temperature: 0,
         max_tokens: 10
      }, {
         headers: {
            'Authorization': `Bearer ${apiKey.trim()}`,
            'Content-Type': 'application/json'
         },
         timeout: 10000
      });

      const text = response.data.choices[0].message.content.trim().toUpperCase();
      console.log(`[Intent Classifier] OpenAI Result: "${text}"`);

      const validIntents = ['ATTENTION', 'SMALL_TALK', 'DATA_GIVE', 'QUERY', 'ACCEPTANCE', 'REJECTION', 'PIVOT', 'CLOSURE'];
      for (const intent of validIntents) {
         if (text.includes(intent)) return intent;
      }

      return 'UNKNOWN';

   } catch (error) {
      console.error('❌ [Intent Classifier] OpenAI Error:', error.response?.data || error.message);
      return 'UNKNOWN';
   }
}
