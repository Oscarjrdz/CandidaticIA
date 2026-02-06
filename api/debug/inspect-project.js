import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'No Redis client' });

        const projectId = 'proj_1770344883461_mshj'; // The one linked to Oscar
        const projectData = await redis.get(`project:${projectId}`);

        if (!projectData) return res.status(404).json({ error: 'Project not found' });

        return res.status(200).json({
            success: true,
            project: JSON.parse(projectData)
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
