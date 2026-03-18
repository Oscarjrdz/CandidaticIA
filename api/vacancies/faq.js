import { getRedisClient } from '../utils/storage.js';
import { reclusterVacancyFaqs } from '../ai/faq-engine.js';
import { getCachedConfig } from '../utils/cache.js';

export default async function handler(req, res) {
    const { method } = req;
    const { vacancyId } = req.query;

    if (!vacancyId) {
        return res.status(400).json({ error: 'vacancyId is required' });
    }

    const client = getRedisClient();
    if (!client) {
        return res.status(500).json({ error: 'Redis client unavailable' });
    }

    const key = `vacancy_faq:${vacancyId}`;

    // Robust body parsing
    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { }
    }

    try {
        if (method === 'GET') {
            const data = await client.get(key);
            let faqs = [];
            if (data) {
                faqs = JSON.parse(data);
                // Removed server-side frequency sort to respect manual user ordering
            }
            return res.status(200).json({ success: true, faqs });
        }

        if (method === 'POST') {
            const { action, faqId, officialAnswer, topic, mediaUrl, order } = body;

            if (action === 'create_category') {
                const data = await client.get(key);
                let faqs = data ? JSON.parse(data) : [];
                
                const newFaq = {
                    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
                    topic: topic || 'Nueva Categoría',
                    originalQuestions: [],
                    frequency: 0,
                    officialAnswer: null,
                    lastAskedAt: new Date().toISOString()
                };
                faqs.push(newFaq);
                await client.set(key, JSON.stringify(faqs));
                return res.status(200).json({ success: true, faqs });
            }

            if (action === 'reorder_categories') {
                if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
                const data = await client.get(key);
                if (!data) return res.status(404).json({ error: 'FAQ list not found' });
                
                let faqs = JSON.parse(data);
                // Map the old objects to the new order
                const orderedFaqs = order.map(id => faqs.find(f => f.id === id)).filter(Boolean);
                // Append any missing categories that weren't in the order array at the end
                const missingFaqs = faqs.filter(f => !order.includes(f.id));
                const finalFaqs = [...orderedFaqs, ...missingFaqs];
                
                await client.set(key, JSON.stringify(finalFaqs));
                return res.status(200).json({ success: true, faqs: finalFaqs });
            }

            // Default: Update officialAnswer, topic, or mediaUrl for a specific FAQ
            if (!faqId) {
                return res.status(400).json({ error: 'faqId is required for update' });
            }

            const data = await client.get(key);
            if (!data) {
                return res.status(404).json({ error: 'FAQ list not found' });
            }

            const faqs = JSON.parse(data);
            const index = faqs.findIndex(f => f.id === faqId);

            if (index === -1) {
                return res.status(404).json({ error: 'FAQ not found' });
            }

            if (topic) faqs[index].topic = topic;
            if (officialAnswer !== undefined) faqs[index].officialAnswer = officialAnswer;
            if (mediaUrl !== undefined) faqs[index].mediaUrl = mediaUrl;

            await client.set(key, JSON.stringify(faqs));

            return res.status(200).json({ success: true, faq: faqs[index] });
        }

        if (method === 'PUT') {
            const { action, faqId, questionText, newQuestionText, targetFaqId, questionsOrder } = body;

            if (action === 'add_question') {
                if (!faqId || !questionText) return res.status(400).json({ error: 'faqId and questionText required' });
                const data = await client.get(key);
                if (!data) return res.status(404).json({ error: 'FAQ list not found' });
                let faqs = JSON.parse(data);
                const index = faqs.findIndex(f => f.id === faqId);
                if (index === -1) return res.status(404).json({ error: 'FAQ not found' });

                faqs[index].originalQuestions = faqs[index].originalQuestions || [];
                faqs[index].originalQuestions.push(questionText.trim());
                await client.set(key, JSON.stringify(faqs));
                return res.status(200).json({ success: true, faqs });
            }

            if (action === 'edit_question') {
                if (!faqId || !questionText || !newQuestionText) return res.status(400).json({ error: 'Missing parameters' });
                const data = await client.get(key);
                if (!data) return res.status(404).json({ error: 'FAQ list not found' });
                let faqs = JSON.parse(data);
                const index = faqs.findIndex(f => f.id === faqId);
                if (index === -1) return res.status(404).json({ error: 'FAQ not found' });

                const qIndex = faqs[index].originalQuestions.findIndex(q => {
                    const cleanQ = typeof q === 'string' ? q : (q.text || '');
                    const target = typeof questionText === 'string' ? questionText : (questionText.text || '');
                    return cleanQ === target;
                });
                if (qIndex !== -1) {
                    faqs[index].originalQuestions[qIndex] = newQuestionText.trim();
                }

                await client.set(key, JSON.stringify(faqs));
                return res.status(200).json({ success: true, faqs });
            }

            if (action === 'reorder_questions') {
                if (!faqId || !Array.isArray(questionsOrder)) return res.status(400).json({ error: 'Missing parameters' });
                const data = await client.get(key);
                if (!data) return res.status(404).json({ error: 'FAQ list not found' });
                let faqs = JSON.parse(data);
                const index = faqs.findIndex(f => f.id === faqId);
                if (index === -1) return res.status(404).json({ error: 'FAQ not found' });

                faqs[index].originalQuestions = questionsOrder;
                await client.set(key, JSON.stringify(faqs));
                return res.status(200).json({ success: true, faqs });
            }

            if (action === 'move_question') {
                if (!faqId || !targetFaqId || !questionText) return res.status(400).json({ error: 'Missing parameters' });
                const data = await client.get(key);
                if (!data) return res.status(404).json({ error: 'FAQ list not found' });
                let faqs = JSON.parse(data);
                
                const srcIdx = faqs.findIndex(f => f.id === faqId);
                const targetIdx = faqs.findIndex(f => f.id === targetFaqId);
                if (srcIdx === -1 || targetIdx === -1) return res.status(404).json({ error: 'FAQ not found' });

                // Remove from source using precise matching
                faqs[srcIdx].originalQuestions = faqs[srcIdx].originalQuestions.filter(q => {
                    const cleanQ = typeof q === 'string' ? q : (q.text || '');
                    const target = typeof questionText === 'string' ? questionText : (questionText.text || '');
                    return cleanQ !== target;
                });

                // Add to target
                faqs[targetIdx].originalQuestions = faqs[targetIdx].originalQuestions || [];
                faqs[targetIdx].originalQuestions.push(questionText);

                await client.set(key, JSON.stringify(faqs));
                return res.status(200).json({ success: true, faqs });
            }

            if (action === 'split') {
                if (!faqId || !questionText) {
                    return res.status(400).json({ error: 'faqId and questionText are required for split' });
                }

                const data = await client.get(key);
                if (!data) return res.status(404).json({ error: 'FAQ list not found' });

                let faqs = JSON.parse(data);
                const index = faqs.findIndex(f => f.id === faqId);

                if (index === -1) return res.status(404).json({ error: 'Source FAQ not found' });

                const sourceFaq = faqs[index];

                // Remove question from source
                sourceFaq.originalQuestions = sourceFaq.originalQuestions.filter(q => {
                    const cleanQ = typeof q === 'string' ? q : (q.text || '');
                    const target = typeof questionText === 'string' ? questionText : (questionText.text || '');
                    return cleanQ !== target;
                });
                sourceFaq.frequency = Math.max(1, (sourceFaq.frequency || 1) - 1);

                // Create new FAQ
                const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
                const newFaq = {
                    id: generateId(),
                    topic: `Tema nuevo: ${typeof questionText === 'string' ? questionText.substring(0, 20) : 'Pregunta'}...`,
                    originalQuestions: [questionText],
                    frequency: 1,
                    officialAnswer: null,
                    lastAskedAt: new Date().toISOString()
                };

                faqs.push(newFaq);

                await client.set(key, JSON.stringify(faqs));
                return res.status(200).json({ success: true, faqs });
            }

            if (action === 'remove_question') {
                if (!faqId || !questionText) {
                    return res.status(400).json({ error: 'faqId and questionText are required' });
                }

                const data = await client.get(key);
                if (!data) return res.status(404).json({ error: 'FAQ list not found' });

                let faqs = JSON.parse(data);
                const index = faqs.findIndex(f => f.id === faqId);
                if (index === -1) return res.status(404).json({ error: 'FAQ not found' });

                faqs[index].originalQuestions = faqs[index].originalQuestions.filter(q => {
                    const cleanQ = typeof q === 'string' ? q : (q.text || '');
                    const target = typeof questionText === 'string' ? questionText : (questionText.text || '');
                    return cleanQ !== target;
                });
                faqs[index].frequency = Math.max(1, (faqs[index].frequency || 1) - 1);

                await client.set(key, JSON.stringify(faqs));
                return res.status(200).json({ success: true, faqs });
            }

            if (action === 'recluster') {
                const config = await getCachedConfig();
                const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;

                const result = await reclusterVacancyFaqs(vacancyId, apiKey);
                if (result.success) {
                    return res.status(200).json({ success: true, faqs: result.faqs });
                } else {
                    return res.status(500).json({ error: result.error || 'Recluster failed' });
                }
            }
        }

        if (method === 'DELETE') {
            const { faqId } = body;
            console.log(`[FAQ API] 🗑️ DELETE request for vacancy ${vacancyId}, faqId: ${faqId}`);
            if (!faqId) {
                return res.status(400).json({ error: 'faqId is required for deletion' });
            }

            const data = await client.get(key);
            if (!data) return res.status(404).json({ error: 'FAQ list not found' });

            let faqs = JSON.parse(data);
            faqs = faqs.filter(f => f.id !== faqId);

            await client.set(key, JSON.stringify(faqs));

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('❌ FAQ API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
