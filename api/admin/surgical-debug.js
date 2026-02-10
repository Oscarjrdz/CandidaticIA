import { getRedisClient, isProfileComplete } from '../utils/storage.js';

export default async function handler(req, res) {
    const { secret } = req.query;
    if (secret !== 'debug_stats_gap_123') return res.status(401).json({ error: 'Unauthorized' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis client failed' });

    try {
        const allIds = await redis.zrevrange('candidates:list', 0, -1);
        const customFieldsJson = await redis.get('custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

        let complete = 0;
        let pending = 0;
        let skippedNull = 0;
        let skippedParseErr = 0;
        let skippedLogicErr = 0;
        const skippedIds = [];

        const CHUNK_SIZE = 100;
        for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
            const chunk = allIds.slice(i, i + CHUNK_SIZE);
            const pipeline = redis.pipeline();
            chunk.forEach(id => pipeline.get(`candidate:${id}`));
            const results = await pipeline.exec();

            results.forEach(([err, data], idx) => {
                const id = chunk[idx];
                if (err || !data) {
                    skippedNull++;
                    skippedIds.push({ id, reason: 'Null or Err' });
                    return;
                }

                try {
                    const c = JSON.parse(data);
                    try {
                        const isComp = isProfileComplete(c, customFields);
                        if (isComp) complete++;
                        else pending++;
                    } catch (logicErr) {
                        skippedLogicErr++;
                        skippedIds.push({ id, reason: 'Logic Err', error: logicErr.message });
                    }
                } catch (pErr) {
                    skippedParseErr++;
                    skippedIds.push({ id, reason: 'Parse Err', error: pErr.message });
                }
            });
        }

        // Forzar actualización de caché para el tablero
        await redis.set('stats:bot:complete', complete);
        await redis.set('stats:bot:pending', pending);
        await redis.set('stats:bot:total', complete + pending);
        await redis.set('stats:bot:last_calc', Date.now().toString());

        return res.json({
            success: true,
            totalIds: allIds.length,
            sumMatched: complete + pending,
            gap: allIds.length - (complete + pending),
            cacheStatus: 'UPDATED',
            stats: {
                complete,
                pending,
                skippedNull,
                skippedParseErr,
                skippedLogicErr
            },
            skippedIds
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
