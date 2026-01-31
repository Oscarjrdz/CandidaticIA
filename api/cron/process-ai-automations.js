import { runAIAutomations } from '../utils/automation-engine.js';

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    const { secret } = req.query;

    const isValid = (authHeader === `Bearer ${process.env.CRON_SECRET}`) || (secret === process.env.CRON_SECRET);

    if (!isValid && process.env.NODE_ENV === 'production' && process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const result = await runAIAutomations();
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
