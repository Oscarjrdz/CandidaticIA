
import { processMessage } from './ai/agent.js';
import { getCandidateIdByPhone, getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    // Default to user's phone if not provided
    const phone = req.query.phone || '5218116038195';
    const message = req.query.message || 'Cuál es mi edad?'; // The query that causes the issue

    try {
        const candidateId = await getCandidateIdByPhone(phone);

        if (!candidateId) {
            return res.status(404).json({
                error: 'Candidate not found',
                searchedPhone: phone
            });
        }

        // Fetch Raw Data to see what we are injecting
        const redis = getRedisClient();
        const rawData = await redis.get(`candidate:${candidateId}`);
        const candidateCtx = rawData ? JSON.parse(rawData) : 'NULL';

        console.log(`🧪 [Debug] Testing AI for candidate ${candidateId}...`);
        console.log(`🧪 [Debug] Context Data Size: ${JSON.stringify(candidateCtx).length} chars`);

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
            context_injected: candidateCtx
        });

    } catch (error) {
        console.error('Debug Error:', error);
        return res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
}
