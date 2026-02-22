import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const candidateId = 'cand_1771740607320_w8sn1y0j9';
        const projectId = 'proj_1771225156891_10ez5k';

        const candidateRaw = await redis.get(`candidatic:candidate:${candidateId}`);
        const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;

        const metaRaw = await redis.hget(`project:cand_meta:${projectId}`, candidateId);
        const meta = metaRaw ? JSON.parse(metaRaw) : {};

        const projectRaw = await redis.get(`project:${projectId}`);
        const project = projectRaw ? JSON.parse(projectRaw) : null;

        return res.status(200).json({
            success: true,
            candidateId,
            projectId,
            candidate,
            meta,
            project: project ? {
                id: project.id,
                name: project.name,
                vacancyIds: project.vacancyIds,
                vacancyId: project.vacancyId
            } : null
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
