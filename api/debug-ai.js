
import { processMessage } from './ai/agent.js';
import { getCandidateIdByPhone } from './utils/storage.js';

export default async function handler(req, res) {
    // Default to user's phone if not provided
    const phone = req.query.phone || '5218116038195';
    const message = req.query.message || 'Cuéntame un dato curioso';

    try {
        const candidateId = await getCandidateIdByPhone(phone);

        if (!candidateId) {
            return res.status(404).json({
                error: 'Candidate not found',
                searchedPhone: phone
            });
        }

        console.log(`🧪 [Debug] Testing AI for candidate ${candidateId} (${phone})...`);
        const start = Date.now();

        // EXECUTE THE AGENT DIRECTLY
        const result = await processMessage(candidateId, message);

        const duration = Date.now() - start;

        return res.json({
            success: !!result,
            candidateId,
            input: message,
            ai_response: result || 'NULL (Agent returned nothing)',
            duration: `${duration}ms`,
            note: 'If ai_response is text, the Bot Logic works perfectly. If NULL, check logs.'
        });

    } catch (error) {
        console.error('Debug Error:', error);
        return res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
}
