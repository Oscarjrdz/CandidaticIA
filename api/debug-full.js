
import { getUltraMsgConfig, getUltraMsgContact } from './whatsapp/utils.js';
import { processMessage } from './ai/agent.js';
import { getCandidateIdByPhone } from './utils/storage.js';

export default async function handler(req, res) {
    const phone = req.query.phone || '5218116038195';
    const chatId = `${phone}@c.us`;
    const message = "Soy de 1983"; // Test message

    const results = {
        profilePic: {},
        ai: {}
    };

    try {
        // 1. Test Profile Pic Raw Response
        try {
            const config = await getUltraMsgConfig();
            if (config) {
                // Call raw axios to see full response structure (bypass util wrapper if needed, 
                // but util wrapper just returns response.data, which is what we want to see)
                const start = Date.now();
                const data = await getUltraMsgContact(config.instanceId, config.token, chatId);
                results.profilePic = {
                    status: 'Called',
                    duration: `${Date.now() - start}ms`,
                    dataType: typeof data,
                    rawData: data,
                    isString: typeof data === 'string',
                    hasImageProp: data && data.image ? 'yes' : 'no'
                };
            } else {
                results.profilePic = { error: 'No Config' };
            }
        } catch (e) {
            results.profilePic = { error: e.message };
        }

        // 2. Test AI Replay
        try {
            const candidateId = await getCandidateIdByPhone(phone);
            if (candidateId) {
                const start = Date.now();
                const reply = await processMessage(candidateId, message);
                results.ai = {
                    status: 'Executed',
                    duration: `${Date.now() - start}ms`,
                    reply: reply
                };
            } else {
                results.ai = { error: 'Candidate Not Found' };
            }
        } catch (e) {
            results.ai = { error: e.message, stack: e.stack };
        }

        return res.json(results);

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
