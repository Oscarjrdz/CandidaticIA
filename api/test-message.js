import { getRedisClient, saveMessage, updateCandidate, getCandidateIdByPhone } from './utils/storage.js';
import axios from 'axios';

/**
 * Endpoint for testing scheduled messages
 * POST /api/test-message
 * Body: { phone, message, botId, apiKey }
 */

const BUILDERBOT_API_URL = 'https://app.builderbot.cloud/api/v2';

const sendBuilderBotMessage = async (botId, apiKey, number, message) => {
    console.log(`🚀 [sendTestMessage] Sending to ${number}...`);
    console.log(`📍 BotId: ${botId ? 'PRESENT' : 'MISSING'}`);
    console.log(`🔑 ApiKey: ${apiKey ? (apiKey.substring(0, 5) + '...') : 'MISSING'}`);

    try {
        const url = `${BUILDERBOT_API_URL}/${botId}/messages`;
        const response = await axios.post(url, {
            messages: {
                type: "text",
                content: message
            },
            number: number,
            checkIfExists: false
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': apiKey,
            },
            validateStatus: () => true
        });

        console.log(`📥 BuilderBot Response: ${response.status} ${response.statusText}`);

        if (response.status !== 200 && response.status !== 201) {
            return {
                success: false,
                error: typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
            };
        }
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Network Error:', error.message);
        return { success: false, error: error.message };
    }
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { phone, message, botId, apiKey } = req.body;

        if (!phone || !message) {
            return res.status(400).json({ error: 'Phone and message are required' });
        }

        const cleanPhone = phone.replace(/\D/g, '');

        let effectiveBotId = botId;
        let effectiveApiKey = apiKey;

        if (!effectiveBotId || !effectiveApiKey) {
            try {
                const redis = getRedisClient();
                if (redis) {
                    const credsJson = await redis.get('builderbot_credentials');
                    if (credsJson) {
                        const creds = JSON.parse(credsJson);
                        if (!effectiveBotId) effectiveBotId = creds.botId;
                        if (!effectiveApiKey) effectiveApiKey = creds.apiKey;
                    }
                }
            } catch (err) {
                console.warn('Failed to load credentials from Redis fallback:', err);
            }
        }

        if (!effectiveBotId || !effectiveApiKey) {
            return res.status(400).json({ error: 'BuilderBot credentials missing' });
        }

        const result = await sendBuilderBotMessage(effectiveBotId, effectiveApiKey, cleanPhone, message);

        if (result.success) {
            // ✅ PROACTIVE SAVE
            try {
                const candidateId = await getCandidateIdByPhone(cleanPhone);
                if (candidateId) {
                    const timestamp = new Date().toISOString();
                    await saveMessage(candidateId, {
                        from: 'bot',
                        content: message,
                        type: 'text',
                        timestamp: timestamp,
                        test: true
                    });

                    await updateCandidate(candidateId, {
                        lastBotMessageAt: timestamp,
                        ultimoMensaje: timestamp
                    });
                    console.log(`💾 Test message saved to history for candidate ${candidateId}`);
                }
            } catch (saveErr) {
                console.warn('⚠️ Could not save test message to history:', saveErr);
            }

            return res.status(200).json({ success: true, data: result.data });
        } else {
            return res.status(502).json({ error: 'Failed to send message', details: result.error });
        }

    } catch (error) {
        console.error('Test Message API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
