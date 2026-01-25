import { sendUltraMsgMessage, getUltraMsgConfig } from './utils.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { to, body, instanceId, token } = req.body;

    if (!to || !body) {
        return res.status(400).json({ error: 'Missing "to" or "body"' });
    }

    try {
        // Use provided credentials or fallback to stored config
        let effectiveInstanceId = instanceId;
        let effectiveToken = token;

        if (!effectiveInstanceId || !effectiveToken) {
            const config = await getUltraMsgConfig();
            if (config) {
                effectiveInstanceId = effectiveInstanceId || config.instanceId;
                effectiveToken = effectiveToken || config.token;
            }
        }

        if (!effectiveInstanceId || !effectiveToken) {
            return res.status(500).json({ error: 'UltraMsg credentials not configured' });
        }

        const result = await sendUltraMsgMessage(effectiveInstanceId, effectiveToken, to, body);
        return res.status(200).json(result);

    } catch (error) {
        return res.status(500).json({
            error: 'Failed to send message',
            details: error.response?.data || error.message
        });
    }
}
