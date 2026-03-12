import axios from 'axios';
import { getRedisClient, recordAITelemetry } from "../utils/storage.js";

/**
 * 🚀 LIVE AI FAQ ENGINE
 * Groups unanswered candidate questions in real-time.
 */
export const processUnansweredQuestion = async (vacancyId, question, responseText, apiKey) => {
    if (!vacancyId || !question || !apiKey) return;

    try {
        const client = getRedisClient();
        if (!client) return;

        const key = `vacancy_faq:${vacancyId}`;
        const data = await client.get(key);
        let faqs = data ? JSON.parse(data) : [];

        // Classification Prompt
        const existingTopics = faqs.map(f => ({
            id: f.id,
            topic: f.topic
        }));

        const prompt = `Actúas como un clasificador de preguntas de candidatos para una vacante de empleo.
Se te ha dado una nueva pregunta: "${question}".

Aquí tienes la lista de temas (topics) existentes:
${JSON.stringify(existingTopics, null, 2)}

Tu tarea es:
1. REGLA DE EXCLUSIÓN CRÍTICA: Si la pregunta NO es sobre la vacante en sí (ej. sueldo, actividades, ubicación, prestaciones), sino sobre el proceso de entrevista (ej. "horarios para agendar", "días disponibles para cita", "¿a qué hora es?", "¿qué día voy?"), sobre el uso del bot, o es un cambio de paso ("ya llegué", "me equivoqué de opción"), DEBES descartarla y devolver "ignore": true.
2. Si NO debe ignorarse y significa lo mismo o pertenece claramente a uno de los temas existentes, devuelve el "id" de ese tema.
3. Si NO debe ignorarse y es una pregunta sobre un tema totalmente nuevo, devuelve "id": null, y sugiere un titulo corto y representativo en "new_topic" (máximo 4 palabras).

IMPORTANTE: El campo "new_topic" DEBE estar siempre en ESPAÑOL.
Responde ÚNICAMENTE en JSON con el siguiente formato:
{
  "ignore": true o false,
  "id": "el-id-existente-o-null",
  "new_topic": "El Nuevo Tema o null"
}
`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const parsed = response.data.choices[0].message.content ? JSON.parse(response.data.choices[0].message.content) : {};

        if (parsed.ignore === true) {
            console.log(`[FAQ Engine] ⏭️ Ignorando pregunta no relacionada a la vacante: "${question}"`);
            return;
        }

        const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

        if (parsed.id) {
            const index = faqs.findIndex(f => f.id === parsed.id);
            if (index !== -1) {
                faqs[index].frequency = (faqs[index].frequency || 1) + 1;
                if (!faqs[index].originalQuestions.includes(question)) {
                    faqs[index].originalQuestions.push(question);
                }
                faqs[index].lastAskedAt = new Date().toISOString();
                faqs[index].lastAiResponse = responseText;
                // Store per-question response
                if (!faqs[index].questionResponses) faqs[index].questionResponses = {};
                faqs[index].questionResponses[question.trim().toLowerCase()] = responseText;
            } else {
                faqs.push({
                    id: generateId(),
                    topic: parsed.new_topic || "Preguntas Generales",
                    originalQuestions: [question],
                    frequency: 1,
                    officialAnswer: null,
                    lastAiResponse: responseText,
                    questionResponses: { [question.trim().toLowerCase()]: responseText },
                    lastAskedAt: new Date().toISOString()
                });
            }
        } else {
            faqs.push({
                id: generateId(),
                topic: parsed.new_topic || "Preguntas Generales",
                originalQuestions: [question],
                frequency: 1,
                officialAnswer: null,
                lastAiResponse: responseText,
                questionResponses: { [question.trim().toLowerCase()]: responseText },
                lastAskedAt: new Date().toISOString()
            });
        }

        await client.set(key, JSON.stringify(faqs));
        console.log(`[FAQ Engine] ✅ Processed question (OpenAI) for vacancy ${vacancyId}: "${question}"`);
        await recordAITelemetry('SYSTEM', 'faq_processed', { vacancyId, question, status: 'success' });

    } catch (e) {
        console.error('❌ FAQ Engine Error (OpenAI):', e.response?.data || e.message);
        await recordAITelemetry('SYSTEM', 'faq_error', { vacancyId, question, error: e.message });
    }
};

/**
 * 🧹 RE-CLUSTER FAQ ENGINE
 * Re-evaluates all existing questions against the current topics using OpenAI.
 */
export const reclusterVacancyFaqs = async (vacancyId, apiKey) => {
    if (!vacancyId || !apiKey) return { success: false, error: 'Missing params' };

    try {
        const client = getRedisClient();
        if (!client) return { success: false, error: 'No Redis' };

        const key = `vacancy_faq:${vacancyId}`;
        const data = await client.get(key);
        if (!data) return { success: true, message: 'No FAQs to recluster' };

        let faqs = JSON.parse(data);
        if (faqs.length === 0) return { success: true };

        const allQuestions = [];
        faqs.forEach(f => {
            (f.originalQuestions || []).forEach(q => {
                if (!allQuestions.includes(q)) allQuestions.push(q);
            });
        });

        const existingTopics = faqs.map(f => ({
            id: f.id,
            topic: f.topic
        }));

        const prompt = `Actúas como un organizador de preguntas de candidatos.
Se te ha dado una lista de preguntas reales y una lista de temas (topics) definidos por el usuario.

TEMAS EXISTENTES:
${JSON.stringify(existingTopics, null, 2)}

PREGUNTAS A CLASIFICAR:
${JSON.stringify(allQuestions, null, 2)}

TU TAREA:
1. REGLA DE EXCLUSIÓN CRÍTICA: Si la pregunta NO es sobre la vacante (sino sobre agendar entrevistas, pedir horarios/días, usar el chatbot o cambios de paso), ignórala devolviendo "topicId": "IGNORE".
2. Para el resto, asigna la pregunta al ID del tema existente que mejor le corresponda. 
3. Si la pregunta es válida sobre la vacante pero no hay un tema que coincida, asígnala a null.

RESPONDE ÚNICAMENTE CON UN ARRAY DE OBJETOS JSON:
{
  "mappings": [
    { "q": "texto de la pregunta", "topicId": "id-del-tema, null o 'IGNORE'" },
    ...
  ]
}`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const result = response.data.choices[0].message.content ? JSON.parse(response.data.choices[0].message.content) : {};
        const mappings = result.mappings || [];

        const newFaqs = faqs.map(f => ({
            ...f,
            originalQuestions: [],
            frequency: 0
        }));

        const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

        mappings.forEach(m => {
            if (m.topicId === 'IGNORE') {
                return; // Silently drop
            } else if (m.topicId) {
                const target = newFaqs.find(f => f.id === m.topicId);
                if (target) {
                    target.originalQuestions.push(m.q);
                    target.frequency++;
                    target.lastAskedAt = new Date().toISOString();
                }
            } else {
                let otros = newFaqs.find(f => f.topic.toLowerCase().includes('otros') || f.topic.toLowerCase().includes('general'));
                if (!otros) {
                    otros = {
                        id: generateId(),
                        topic: "Otras Consultas",
                        originalQuestions: [],
                        frequency: 0,
                        officialAnswer: null,
                        lastAskedAt: new Date().toISOString()
                    };
                    newFaqs.push(otros);
                }
                otros.originalQuestions.push(m.q);
                otros.frequency++;
            }
        });

        const filteredFaqs = newFaqs.filter(f => f.frequency > 0 || f.officialAnswer);

        await client.set(key, JSON.stringify(filteredFaqs));
        await recordAITelemetry('SYSTEM', 'faq_recluster', { vacancyId, totalQuestions: allQuestions.length });

        return { success: true, faqs: filteredFaqs };

    } catch (e) {
        console.error('❌ Recluster Error (OpenAI):', e.response?.data || e.message);
        return { success: false, error: e.message };
    }
};
