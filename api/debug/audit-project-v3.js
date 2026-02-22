import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        if (req.query.action === 'listKeys') {
            const keys = await redis.keys('*');
            return res.status(200).json({ success: true, count: keys.length, keys });
        }

        if (req.query.action === 'searchByPhone') {
            const phoneSearch = req.query.phone || '96877383037071';
            const suffix = phoneSearch.slice(-11); // Last 11 digits

            let foundCandidate = null;
            let candidateId = null;

            const candidateKeys = await redis.keys('candidate:*');
            for (const key of candidateKeys) {
                const data = await redis.get(key);
                if (data && data.includes(suffix)) {
                    foundCandidate = JSON.parse(data);
                    candidateId = key.replace('candidate:', '');
                    break;
                }
            }

            if (!foundCandidate) {
                return res.status(404).json({ error: 'Candidate not found by suffix', suffix, totalCandidatesChecked: candidateKeys.length });
            }

            const projectId = foundCandidate.projectId || (foundCandidate.projectMetadata?.projectId);

            // Fetch project details if projectId is found
            let project = null;
            if (projectId) {
                const projectRaw = await redis.get(`project:${projectId}`);
                project = projectRaw ? JSON.parse(projectRaw) : null;
            }

            return res.status(200).json({
                success: true,
                candidateId,
                phone,
                candidate: foundCandidate,
                projectId,
                project: project ? {
                    id: project.id,
                    name: project.name,
                    vacancyIds: project.vacancyIds,
                    vacancyId: project.vacancyId
                } : null
            });
        }

        const candidateId = 'cand_1771772235504_hiivto169';
        const projectId = 'proj_1771225156891_10ez5k';

        // Try direct key first
        const candidateRaw = await redis.get(`candidate:${candidateId}`);
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
