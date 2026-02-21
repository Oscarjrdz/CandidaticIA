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

IMPORTANTE: Responde ÚNICAMENTE en JSON con el siguiente formato:
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
