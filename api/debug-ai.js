
import { processMessage } from './ai/agent.js';
import { getCandidateIdByPhone } from './utils/storage.js';

export default async function handler(req, res) {
    const { phone, message } = req.query;

    if (!phone || !message) {
        return res.json({
            error: 'Missing params',
            usage: '/api/debug-ai?phone=5218116038195&message=hola'
        });
    }

    try {
        const candidateId = await getCandidateIdByPhone(phone);
        if (!candidateId) {
            return res.json({ error: 'Candidate not found for phone ' + phone });
        }

        console.log('--- DEBUG AI START ---');
        const response = await processMessage(candidateId, message);
        console.log('--- DEBUG AI END ---');

        return res.json({
            success: true,
            candidateId,
            input: message,
            aiResponse: response,
            note: 'If aiResponse is null, check server logs or keys.'
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
}
