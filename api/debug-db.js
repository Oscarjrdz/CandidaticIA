export default async function handler(req, res) {
    const { phone } = req.query;
    if (!phone) return res.json({ error: 'Missing phone' });

    try {
        const { getRedisClient, getCandidateIdByPhone, getCandidateById } = await import('./utils/storage.js');
        const redis = getRedisClient();

        const indexId = await redis.hget('candidatic:phone_index', phone);
        const resolvedId = await getCandidateIdByPhone(phone);

        // Scan
        const list = await redis.zrange('candidates:list', 0, -1);
        let foundInScan = null;
        for (const id of list) {
            const data = await redis.get(`candidate:${id}`);
            if (data && data.includes(phone)) {
                foundInScan = { id, data: JSON.parse(data) };
                break;
            }
        }

        return res.json({
            indexId,
            resolvedId,
            foundInScan,
            dbSize: list.length,
            redisStatus: redis.status
        });
    } catch (e) {
        return res.json({ error: e.message, stack: e.stack });
    }
}
