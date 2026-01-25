
import { processMessage } from './ai/agent.js';
import { getCandidateIdByPhone, getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const phone = req.query.phone || '5218116038195';
    const message = req.query.message || 'Soy de 1983';

    try {
        const candidateId = await getCandidateIdByPhone(phone);
        if (!candidateId) return res.status(404).json({ error: 'Candidate not found' });

        console.log(`🔄 [Replay] Processing message for ${candidateId}: "${message}"`);

        const start = Date.now();
        let result;
        let error = null;

        try {
            result = await processMessage(candidateId, message);
        } catch (e) {
            error = { message: e.message, stack: e.stack };
        }

        return res.json({
            phone,
            candidateId,
            input: message,
            result,
            error,
            duration: `${Date.now() - start}ms`
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
