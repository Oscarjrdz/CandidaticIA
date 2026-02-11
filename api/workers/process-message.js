import { processMessage } from '../ai/agent.js';
import { getCandidateById } from '../utils/storage.js';

/**
 * Async Worker for Message Processing
 * Processes WhatsApp messages in background without blocking webhook
 * Implements retry logic with exponential backoff
 */

/**
 * Process message with automatic retry
 * @param {string} candidateId - Candidate ID
 * @param {string} message - Message content
 * @param {string} messageId - Message ID for reactions
 * @param {number} attempt - Current attempt number
 * @returns {Promise<Object>}
 */
async function processWithRetry(candidateId, message, options = {}, attempt = 1) {
    const { messageId, host } = options;
    const MAX_RETRIES = 3;
    const BASE_DELAY = 2000; // 2 seconds

    try {
        // Verify candidate exists
        const candidate = await getCandidateById(candidateId);
        if (!candidate) {
            throw new Error(`Candidate ${candidateId} not found`);
        }

        // 🛡️ [BLOCK SHIELD]: Force early exit if candidate is blocked
        if (candidate.blocked === true) {
            console.log(`[BLOCK SHIELD] Skipping worker processing for blocked candidate: ${candidateId}`);
            return { success: true, message: 'Candidate is blocked', blocked: true };
        }

        // Process message with Brenda
        await processMessage(candidateId, message, { msgId: messageId, host });

        return {
            success: true,
            attempt,
            candidateId
        };
    } catch (error) {
        console.error(`❌ Worker error (attempt ${attempt}/${MAX_RETRIES}):`, error.message);

        // Retry if we haven't exceeded max attempts
        if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY * Math.pow(2, attempt - 1); // 2s, 4s, 8s
            console.log(`⏳ Retrying in ${delay}ms...`);

            await new Promise(resolve => setTimeout(resolve, delay));
            return processWithRetry(candidateId, message, options, attempt + 1);
        }

        // Max retries exceeded
        console.error(`❌ FAILED after ${MAX_RETRIES} attempts:`, error);
        throw error;
    }
}

export default async function handler(req, res) {
    // Only accept POST
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed',
            allowedMethods: ['POST']
        });
    }

    const { candidateId, message, messageId, from, host } = req.body;

    // Validate required fields
    if (!candidateId || !message) {
        return res.status(400).json({
            error: 'Missing required fields',
            required: ['candidateId', 'message']
        });
    }

    try {
        console.log(`🔄 Worker processing message ${messageId} from ${from} (Host: ${host})`);

        const result = await processWithRetry(candidateId, message, { messageId, host });

        console.log(`✅ Worker completed:`, result);

        return res.status(200).json({
            success: true,
            messageId,
            attempts: result.attempt,
            candidateId: result.candidateId
        });
    } catch (error) {
        console.error('❌ Worker final error:', error);

        return res.status(500).json({
            success: false,
            error: error.message,
            messageId,
            candidateId
        });
    }
}
