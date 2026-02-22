import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const phone = '96877383037071'; // Oscar
        const candidateId = 'cand_1771740607320_w8sn1y0j9';

        // 1. Get Candidate Data
        const candidateRaw = await redis.get(`candidatic:candidate:${candidateId}`);
        const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;

        if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

        const projectId = candidate.projectId || candidate.projectMetadata?.projectId;
        if (!projectId) return res.status(404).json({ error: 'Candidate has no active project', candidate });

        // 2. Get Project Data
        const projectRaw = await redis.get(`project:${projectId}`);
        const project = projectRaw ? JSON.parse(projectRaw) : null;

        // 3. Get Project-Candidate Metadata
        const metaRaw = await redis.hget(`project:cand_meta:${projectId}`, candidateId);
        const meta = metaRaw ? JSON.parse(metaRaw) : {};

        return res.status(200).json({
            success: true,
            candidate: {
                id: candidateId,
                projectId,
                currentVacancyIndex: candidate.currentVacancyIndex,
                projectMetadata: candidate.projectMetadata
            },
            project,
            cand_meta: meta
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
