import { runAIAutomations } from '../utils/automation-engine.js';

export default async function handler(req, res) {
    // Basic security with query param
    if (req.query.secret !== 'debug_brenda_123') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('--- 🕵️ DEBUG TRACE START ---');
        // Manual run with logs
        const result = await runAIAutomations(true);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
}
