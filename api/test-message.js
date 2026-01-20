/**
 * Endpoint for testing scheduled messages
 * POST /api/test-message
 * Body: { phone, message, botId, apiKey }
 */

const BUILDERBOT_API_URL = 'https://app.builderbot.cloud/api/v2';

const sendBuilderBotMessage = async (botId, apiKey, number, message) => {
    try {
        const response = await fetch(`${BUILDERBOT_API_URL}/${botId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': apiKey,
            },
            body: JSON.stringify({
                messages: {
                    type: "text",
                    content: message
                },
                number: number
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            console.error('BuilderBot Error:', data);
            return { success: false, error: data };
        }
        return { success: true, data };
    } catch (error) {
        console.error('Network Error:', error);
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

        // Clean phone number
        const cleanPhone = phone.replace(/\D/g, '');

        // Use provided credentials or env vars
        const effectiveBotId = botId || process.env.BOT_ID;
        const effectiveApiKey = apiKey || process.env.BOT_TOKEN;

        if (!effectiveBotId || !effectiveApiKey) {
            return res.status(400).json({ error: 'BuilderBot credentials missing (BOT_ID or BOT_TOKEN)' });
        }

        const result = await sendBuilderBotMessage(effectiveBotId, effectiveApiKey, cleanPhone, message);

        if (result.success) {
            return res.status(200).json({ success: true, data: result.data });
        } else {
            return res.status(502).json({ error: 'Failed to send message', details: result.error });
        }

    } catch (error) {
        console.error('Test Message API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
