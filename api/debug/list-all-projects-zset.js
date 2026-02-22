import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const projectIds = await redis.zrange('projects:all', 0, -1);
        const projects = [];
        for (const id of projectIds) {
            const data = await redis.get(`project:${id}`);
            if (data) projects.push(JSON.parse(data));
        }

        return res.status(200).json({
            success: true,
            projectIds,
            projects: projects.map(p => ({
                id: p.id,
                name: p.name,
                vacancyIds: p.vacancyIds || [],
                vacancyId: p.vacancyId || null
            }))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
