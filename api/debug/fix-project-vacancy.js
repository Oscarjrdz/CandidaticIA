import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const projectId = 'proj_1771225156891_10ez5k';
        const projectRaw = await redis.get(`project:${projectId}`);
        if (!projectRaw) return res.status(404).json({ error: 'Project not found' });

        const project = JSON.parse(projectRaw);

        // Remove legacy vacancyId field, keep only vacancyIds array
        const before = { vacancyId: project.vacancyId, vacancyIds: project.vacancyIds };
        delete project.vacancyId;

        await redis.set(`project:${projectId}`, JSON.stringify(project));

        // Verify
        const afterRaw = await redis.get(`project:${projectId}`);
        const after = JSON.parse(afterRaw);

        return res.status(200).json({
            success: true,
            before,
            after: { vacancyId: after.vacancyId, vacancyIds: after.vacancyIds },
            message: 'Legacy vacancyId removed. Project now uses vacancyIds array only.'
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
