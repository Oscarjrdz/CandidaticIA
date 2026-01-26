import { runAIAutomations } from '../../utils/automation-engine.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // This is called from the UI, so it doesn't need CRON_SECRET
        // In a real app, this would be protected by session/admin auth.
        const result = await runAIAutomations();
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
