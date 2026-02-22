import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const projectId = 'proj_1771225156891_10ez5k';
        const key = `project:candidates:${projectId}`;
        const type = await redis.type(key);

        let candidateIds = [];
        if (type === 'set') {
            candidateIds = await redis.smembers(key);
        } else if (type === 'list') {
            candidateIds = await redis.lrange(key, 0, -1);
        } else if (type === 'zset') {
            candidateIds = await redis.zrange(key, 0, -1);
        }

        const candidates = [];
        for (const id of candidateIds) {
            const data = await redis.get(`candidate:${id}`);
            if (data) {
                const parsed = JSON.parse(data);
                candidates.push({
                    id,
                    name: parsed.nombreReal || parsed.nombre || 'N/A',
                    phone: parsed.whatsapp || parsed.phone || 'N/A',
                    vIdx: parsed.currentVacancyIndex
                });
            }
        }

        return res.status(200).json({
            success: true,
            projectId,
            keyType: type,
            count: candidateIds.length,
            candidates
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
