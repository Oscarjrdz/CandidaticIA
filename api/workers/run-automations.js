import { runAIAutomations } from '../utils/automation-engine.js';
import { logTelemetry } from '../utils/telemetry.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { targetProjectId, stepId, candidateId } = req.body;

    if (!targetProjectId || !stepId || !candidateId) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    console.log(`[Worker Background] ⚙️ Starting isolated automation for Cand: ${candidateId} | Proj: ${targetProjectId}`);

    try {
        await logTelemetry('background_automation_start', { candidateId, targetProjectId, stepId });
        await runAIAutomations(true, {
            projectId: targetProjectId,
            stepId: stepId,
            targetCandidateId: candidateId
        });
        await logTelemetry('background_automation_complete', { candidateId });
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[Worker Background] ❌ Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
