import { answerCandidateKnowledgeQuestion, getCandidateKnowledgeSnapshot } from '../utils/copilot-candidate-knowledge.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const snapshot = await getCandidateKnowledgeSnapshot();
            return res.status(200).json({ success: true, skill: 'candidate_knowledge', snapshot });
        }

        if (req.method === 'POST') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
            const question = String(body.message || body.question || '').trim();
            if (!question) {
                return res.status(400).json({ success: false, error: 'Falta la pregunta' });
            }

            const result = await answerCandidateKnowledgeQuestion(question, body.history || []);
            return res.status(200).json({
                success: true,
                skill: result.skill,
                reply: result.reply,
                model: result.model,
                snapshot: result.snapshot
            });
        }

        return res.status(405).json({ success: false, error: 'Método no permitido' });
    } catch (error) {
        console.error('[Candidate Knowledge Skill] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'No pude consultar la base de candidatos.',
            detail: error.message
        });
    }
}
