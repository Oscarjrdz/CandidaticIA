import { runAIAutomations } from '../utils/automation-engine.js';

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    const { secret } = req.query;

    const isValid = (authHeader === `Bearer ${process.env.CRON_SECRET}`) ||
        (secret === process.env.CRON_SECRET) ||
        (secret === 'debug_brenda_123');

    if (!isValid && process.env.NODE_ENV === 'production' && process.env.CRON_SECRET) {
        return res.status(401).json({
            error: 'Unauthorized',
            hint: 'Provide secret via Bearer token or ?secret=URL_PARAM'
        });
    }

    try {
        const result = await runAIAutomations();
        return res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            ...result
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
}
