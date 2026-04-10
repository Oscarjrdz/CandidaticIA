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
        // Use provided credentials or fallback to candidate's assigned instance
        let effectiveInstanceId = instanceId;
        let effectiveToken = token;

        if (!effectiveInstanceId || !effectiveToken) {
            // Try to resolve the candidate's assigned instance first
            let resolvedInstanceId = null;
            try {
                const { getRedisClient } = await import('../utils/storage.js');
                const redis = getRedisClient();
                if (redis) {
                    const cleanPhone = String(to).replace(/\D/g, '');
                    resolvedInstanceId = await redis.get(`candidate_instance:${cleanPhone}`);
                }
            } catch (e) { /* non-critical */ }

            const config = await getUltraMsgConfig(resolvedInstanceId);
            if (config) {
                effectiveInstanceId = effectiveInstanceId || config.instanceId;
                effectiveToken = effectiveToken || config.token;
            }
        }

        if (!effectiveInstanceId || !effectiveToken) {
            return res.status(500).json({ error: 'WhatsApp credentials not configured' });
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
