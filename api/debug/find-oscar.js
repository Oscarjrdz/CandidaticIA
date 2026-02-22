import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const phone = '96877383037071'; // Oscar
        const candidateIdFromIndex = await redis.hget('candidatic:phone_index', phone);

        const reverseIndexedProject = await redis.hget('index:cand_project', candidateIdFromIndex);

        const keys = await redis.keys('candidate:*');
        const candidatesWithPhone = [];
        for (const key of keys) {
            const data = await redis.get(key);
            if (data && data.includes(phone)) {
                candidatesWithPhone.push(JSON.parse(data));
            }
        }

        return res.status(200).json({
            success: true,
            candidateIdFromIndex,
            reverseIndexedProject,
            candidatesFoundWithThatPhone: candidatesWithPhone.map(c => ({
                id: c.id,
                projectId: c.projectId,
                metaId: c.projectMetadata?.projectId,
                vIdx: c.currentVacancyIndex
            }))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
