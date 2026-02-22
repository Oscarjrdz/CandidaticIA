import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const projectId = 'proj_1771225156891_10ez5k';
        const project = await redis.get(`project:${projectId}`);
        const parsedProject = project ? JSON.parse(project) : null;

        return res.status(200).json({
            success: true,
            projectId,
            project: parsedProject
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
