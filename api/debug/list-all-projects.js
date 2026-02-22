import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        // Use the proper ZSET if available, or more specific pattern
        const keys = await redis.keys('project:proj_*');
        const projects = [];
        for (const key of keys) {
            const data = await redis.get(key);
            if (data) projects.push(JSON.parse(data));
        }

        return res.status(200).json({
            success: true,
            count: projects.length,
            projects: projects.map(p => ({
                id: p.id,
                name: p.name,
                vacancyIds: p.vacancyIds || [],
                vacancyId: p.vacancyId || p.vacancyId_old || null,
                stepsCount: p.steps?.length || 0
            }))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
