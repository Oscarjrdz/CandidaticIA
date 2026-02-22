import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const phone = '96877383037071'; // Oscar

        const allPhones = await redis.hgetall('candidatic:phone_index');

        // 1. Find Candidate by Phone
        const candidateId = await redis.hget('candidatic:phone_index', phone);
        if (!candidateId) return res.status(404).json({
            error: 'Candidate not found by phone',
            phone,
            indexedPhones: allPhones
        });

        // 2. Get Candidate Data
        const candidateRaw = await redis.get(`candidatic:candidate:${candidateId}`);
        const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;

        if (!candidate) return res.status(404).json({ error: 'Candidate data missing', candidateId });

        const projectId = candidate.projectId || (candidate.projectMetadata?.projectId);

        // 3. Get Project Data
        const project = projectId ? JSON.parse(await redis.get(`project:${projectId}`)) : null;

        // 4. Get Vacancies Data
        const vacanciesRaw = await redis.get('candidatic_vacancies');
        const allVacancies = vacanciesRaw ? JSON.parse(vacanciesRaw) : [];

        // 5. Get Project-Candidate Metadata
        const meta = projectId ? JSON.parse(await redis.hget(`project:cand_meta:${projectId}`, candidateId) || '{}') : {};

        return res.status(200).json({
            success: true,
            candidate: {
                id: candidateId,
                projectId,
                currentVacancyIndex: candidate.currentVacancyIndex || candidate.projectMetadata?.currentVacancyIndex || 0,
                projectMetadata: candidate.projectMetadata
            },
            project,
            cand_meta: meta,
            vacanciesInSystem: allVacancies.map(v => ({ id: v.id, name: v.name }))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
