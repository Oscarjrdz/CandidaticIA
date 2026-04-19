import { sendMetaMessage } from './utils.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { to, body, type } = req.body;

    if (!to || !body) {
        return res.status(400).json({ error: 'Missing "to" or "body"' });
    }

    try {
        const result = await sendMetaMessage(to, body, type || 'chat');
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({
            error: 'Failed to send message',
            details: error.message
        });
    }
}
