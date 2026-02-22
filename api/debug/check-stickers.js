import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });
    try {
        const keys = [
            'bot_bridge_inicio',
            'bot_bridge_cita',
            'bot_bridge_exit',
            'bot_bridge_citados'
        ];
        const results = {};
        for (const key of keys) {
            results[key] = await redis.get(key);
        }

        // Also check project steps
        const projectId = 'proj_1771225156891_10ez5k';
        const projectRaw = await redis.get(`project:${projectId}`);
        const project = projectRaw ? JSON.parse(projectRaw) : null;

        return res.status(200).json({ stickers: results, projectSteps: project?.steps?.map(s => ({ id: s.id, name: s.name })) });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
