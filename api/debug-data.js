
import { getRedisClient, getCandidateIdByPhone } from './utils/storage.js';
import { getUltraMsgConfig, getUltraMsgContact } from './whatsapp/utils.js';

export default async function handler(req, res) {
    const phone = req.query.phone || '5218116038195'; // Default to user's number
    const redis = getRedisClient();

    try {
        // 1. Check Candidate Data in Redis
        const candidateId = await getCandidateIdByPhone(phone);
        let candidateData = null;
        if (candidateId) {
            const raw = await redis.get(`candidate:${candidateId}`);
            candidateData = raw ? JSON.parse(raw) : null;
        }

        // 2. Test UltraMsg Contact Fetch
        const config = await getUltraMsgConfig();
        let ultraMsgResult = null;
        let ultraMsgError = null;

        if (config) {
            try {
                // Try fetching with the raw phone (as chatId)
                ultraMsgResult = await getUltraMsgContact(config.instanceId, config.token, phone + '@c.us');
                // Also try without @c.us just in case
                if (!ultraMsgResult) {
                    ultraMsgResult = await getUltraMsgContact(config.instanceId, config.token, phone);
                }
            } catch (e) {
                ultraMsgError = e.message;
            }
        }

        return res.json({
            phone,
            candidateId,
            candidateDataInRedis: candidateData, // Check if 'fechaNacimiento' and 'profilePic' exist here
            ultraMsgConfigFound: !!config,
            ultraMsgContactTest: ultraMsgResult,
            ultraMsgError
        });

    } catch (error) {
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
}
