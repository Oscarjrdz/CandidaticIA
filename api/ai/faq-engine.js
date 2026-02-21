import { GoogleGenerativeAI } from "@google/generative-ai";
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

        const genAI = new GoogleGenerativeAI(apiKey);

        // Fast, cheap model for clustering (v2.0 fixed 404 errors)
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
            }
        });

        // We only pass the topics to save tokens
        const existingTopics = faqs.map(f => ({
            id: f.id,
            topic: f.topic
        }));

        const prompt = `Actúas como un clasificador de preguntas de candidatos para una vacante de empleo.
Se te ha dado una nueva pregunta: "${question}".

Aquí tienes la lista de temas (topics) existentes:
${JSON.stringify(existingTopics, null, 2)}

Tu tarea es:
1. Si la nueva pregunta significa lo mismo o pertenece claramente a uno de los temas existentes, devuelve el "id" de ese tema.
2. Si es una pregunta sobre un tema totalmente nuevo, devuelve "id": null, y sugiere un titulo corto y representativo en "new_topic" (máximo 4 palabras).

IMPORTANTE: El campo "new_topic" DEBE estar siempre en ESPAÑOL.
Responde ÚNICAMENTE en JSON con el siguiente formato:
{
  "id": "el-id-existente-o-null",
  "new_topic": "El Nuevo Tema o null"
}
`;

        const result = await model.generateContent(prompt);
        let responseJson = result.response.text().trim();

        if (responseJson.startsWith('```json')) {
            responseJson = responseJson.replace(/```json\n?/, '').replace(/```\n?$/, '');
        }

        const parsed = JSON.parse(responseJson);

        const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

        if (parsed.id) {
            // Found an existing topic
            const index = faqs.findIndex(f => f.id === parsed.id);
            if (index !== -1) {
                faqs[index].frequency = (faqs[index].frequency || 1) + 1;
                if (!faqs[index].originalQuestions.includes(question)) {
                    faqs[index].originalQuestions.push(question);
                }
                faqs[index].lastAskedAt = new Date().toISOString();
                // Store the last AI response for auditing
                faqs[index].lastAiResponse = responseText;
            } else {
                // Fallback if AI hallucinations an ID
                faqs.push({
                    id: generateId(),
                    topic: parsed.new_topic || "Preguntas Generales",
                    originalQuestions: [question],
                    frequency: 1,
                    officialAnswer: null,
                    lastAiResponse: responseText,
                    lastAskedAt: new Date().toISOString()
                });
            }
        } else {
            // New topic
            faqs.push({
                id: generateId(),
                topic: parsed.new_topic || "Preguntas Generales",
                originalQuestions: [question],
                frequency: 1,
                officialAnswer: null,
                lastAiResponse: responseText,
                lastAskedAt: new Date().toISOString()
            });
        }

        // Save back to Redis
        await client.set(key, JSON.stringify(faqs));
        console.log(`[FAQ Engine] ✅ Processed question for vacancy ${vacancyId}: "${question}"`);
        await recordAITelemetry('SYSTEM', 'faq_processed', { vacancyId, question, status: 'success' });

    } catch (e) {
        console.error('❌ FAQ Engine Error:', e);
        await recordAITelemetry('SYSTEM', 'faq_error', { vacancyId, question, error: e.message });
    }
};
/**
 * 🧹 RE-CLUSTER FAQ ENGINE
 * Re-evaluates all existing questions against the current topics.
 * Useful after renaming topics to improve classification.
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

        // 1. Gather all unique questions and their associated metadata (like officialAnswer)
        // We'll try to preserve officialAnswers if they exist for a topic.
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

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
            }
        });

        // 2. Ask AI to map EACH question to the best topic
        const prompt = `Actúas como un organizador de preguntas de candidatos.
Se te ha dado una lista de preguntas reales y una lista de temas (topics) definidos por el usuario.

TEMAS EXISTENTES:
${JSON.stringify(existingTopics, null, 2)}

PREGUNTAS A CLASIFICAR:
${JSON.stringify(allQuestions, null, 2)}

TU TAREA:
Asigna cada pregunta al ID del tema que mejor le corresponda. 
Si una pregunta no encaja en NINGUNO de los temas actuales, asígnala a null.

RESPONDE ÚNICAMENTE CON UN ARRAY DE OBJETOS JSON:
[
  { "q": "texto de la pregunta", "topicId": "id-del-tema o null" },
  ...
]`;

        const result = await model.generateContent(prompt);
        let responseJson = result.response.text().trim();
        if (responseJson.startsWith('```json')) {
            responseJson = responseJson.replace(/```json\n?/, '').replace(/```\n?$/, '');
        }

        const mappings = JSON.parse(responseJson);

        // 3. Rebuild the FAQ structure
        // We keep the old topics (to preserve officialAnswers) but clear their questions
        const newFaqs = faqs.map(f => ({
            ...f,
            originalQuestions: [],
            frequency: 0
        }));

        const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

        mappings.forEach(m => {
            if (m.topicId) {
                const target = newFaqs.find(f => f.id === m.topicId);
                if (target) {
                    target.originalQuestions.push(m.q);
                    target.frequency++;
                    target.lastAskedAt = new Date().toISOString();
                }
            } else {
                // Orphan question or needs new topic
                // For simplicity in recluster, we find or create an "Otros" topic if not mapped
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

        // Remove topics that ended up with 0 questions (unless they have an official answer)
        const filteredFaqs = newFaqs.filter(f => f.frequency > 0 || f.officialAnswer);

        await client.set(key, JSON.stringify(filteredFaqs));
        await recordAITelemetry('SYSTEM', 'faq_recluster', { vacancyId, totalQuestions: allQuestions.length });

        return { success: true, faqs: filteredFaqs };

    } catch (e) {
        console.error('❌ Recluster Error:', e);
        return { success: false, error: e.message };
    }
};
