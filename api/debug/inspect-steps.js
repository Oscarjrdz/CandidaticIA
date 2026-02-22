import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });
    try {
        const projectId = 'proj_1771225156891_10ez5k';
        const raw = await redis.get(`project:${projectId}`);
        const project = raw ? JSON.parse(raw) : null;
        if (!project) return res.status(404).json({ error: 'Project not found' });

        return res.status(200).json({
            steps: project.steps?.map(s => ({
                id: s.id,
                name: s.name,
                aiEnabled: s.aiConfig?.enabled,
                hasPrompt: !!s.aiConfig?.prompt,
                promptPreview: s.aiConfig?.prompt?.substring(0, 150)
            }))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
