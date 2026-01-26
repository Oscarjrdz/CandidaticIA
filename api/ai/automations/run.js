import { runAIAutomations } from '../../utils/automation-engine.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Manual runs from UI bypass cooldown to allow immediate testing
        const result = await runAIAutomations(true);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
