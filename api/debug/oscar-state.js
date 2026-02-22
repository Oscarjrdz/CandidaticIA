import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const candidateId = 'cand_1771772235504_hiivto169';
        const projectId = 'proj_1771225156891_10ez5k';

        const candidateRaw = await redis.get(`candidate:${candidateId}`);
        const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;

        const metaRaw = await redis.hget(`project:cand_meta:${projectId}`, candidateId);
        const meta = metaRaw ? JSON.parse(metaRaw) : null;

        const projectRaw = await redis.get(`project:${projectId}`);
        const project = projectRaw ? JSON.parse(projectRaw) : null;

        return res.status(200).json({
            success: true,
            candidateId,
            candidate: candidate ? {
                id: candidate.id,
                name: candidate.nombreReal,
                phone: candidate.whatsapp,
                projectId: candidate.projectId,
                currentVacancyIndex: candidate.currentVacancyIndex,
                projectMetadata: candidate.projectMetadata
            } : null,
            projectMeta: meta,
            vacancyIds: project?.vacancyIds,
            totalVacancies: project?.vacancyIds?.length || 0
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
