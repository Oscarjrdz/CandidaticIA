import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });
    try {
        const projectId = 'proj_1771225156891_10ez5k';
        const raw = await redis.get(`project:${projectId}`);
        const project = raw ? JSON.parse(raw) : null;
        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Get specific step
        const targetStep = req.query.step || 'cita';
        const step = project.steps?.find(s => s.name?.toLowerCase() === targetStep.toLowerCase());

        // Also check stickers
        const stickerKeys = ['bot_step_move_sticker', 'bot_bridge_inicio', 'bot_bridge_cita'];
        const stickers = {};
        for (const k of stickerKeys) {
            const val = await redis.get(k);
            stickers[k] = val ? val.substring(0, 50) + '...' : null;
        }

        return res.status(200).json({
            step: step ? {
                id: step.id,
                name: step.name,
                aiEnabled: step.aiConfig?.enabled,
                hasPrompt: !!step.aiConfig?.prompt,
                fullPrompt: step.aiConfig?.prompt
            } : null,
            allSteps: project.steps?.map(s => ({ id: s.id, name: s.name, aiEnabled: s.aiConfig?.enabled })),
            stickers
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
