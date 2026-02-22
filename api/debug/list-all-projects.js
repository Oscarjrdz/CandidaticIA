import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const keys = await redis.keys('project:*');
        const projects = [];
        for (const key of keys) {
            if (key.startsWith('project:cand_meta:')) continue;
            if (key.includes(':searches:')) continue;
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
                vacancyId: p.vacancyId || null
            }))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
