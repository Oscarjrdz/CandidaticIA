import { getRedisClient } from '../utils/storage.js';

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
                // Sort by frequency descending
                faqs.sort((a, b) => b.frequency - a.frequency);
            }
            return res.status(200).json({ success: true, faqs });
        }

        if (method === 'POST') {
            // Update officialAnswer for a specific FAQ
            const { faqId, officialAnswer } = body;

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

            faqs[index].officialAnswer = officialAnswer;

            await client.set(key, JSON.stringify(faqs));

            return res.status(200).json({ success: true, faq: faqs[index] });
        }

        if (method === 'PUT') {
            const { action, faqId, questionText } = body;

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
                sourceFaq.originalQuestions = sourceFaq.originalQuestions.filter(q => q !== questionText);
                sourceFaq.frequency = Math.max(1, (sourceFaq.frequency || 1) - 1);

                // Create new FAQ
                const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
                const newFaq = {
                    id: generateId(),
                    topic: `Tema nuevo: ${questionText.substring(0, 20)}...`,
                    originalQuestions: [questionText],
                    frequency: 1,
                    officialAnswer: null,
                    lastAskedAt: new Date().toISOString()
                };

                faqs.push(newFaq);

                await client.set(key, JSON.stringify(faqs));
                return res.status(200).json({ success: true, faqs });
            }
        }

        if (method === 'DELETE') {
            const { faqId } = body;
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
