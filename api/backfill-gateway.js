/**
 * 🔧 ONE-TIME BACKFILL: Migrate gateway_instance candidates to meta_cloud_api
 *
 * Usage: GET /api/backfill-gateway?confirm=yes
 * Delete this file after running it once.
 */
import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.query.confirm !== 'yes') {
        return res.status(200).json({
            message: 'Dry run. Add ?confirm=yes to execute.',
            description: 'Migrates all candidates with origen=gateway_instance to meta_cloud_api and activates bot'
        });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    try {
        const [completeIds, pendingIds] = await Promise.all([
            redis.smembers('stats:list:complete'),
            redis.smembers('stats:list:pending')
        ]);

        const allIds = [...new Set([...completeIds, ...pendingIds])];
        let migrated = 0;
        let skipped = 0;

        const CHUNK = 100;
        for (let i = 0; i < allIds.length; i += CHUNK) {
            const chunk = allIds.slice(i, i + CHUNK);
            const pipeline = redis.pipeline();
            chunk.forEach(id => pipeline.get(`candidate:${id}`));
            const results = await pipeline.exec();

            const writePipeline = redis.pipeline();
            let writes = 0;

            results.forEach(([err, raw], idx) => {
                if (err || !raw) return;
                try {
                    const c = JSON.parse(raw);
                    const id = chunk[idx];

                    if (c.origen === 'gateway_instance') {
                        c.origen = 'meta_cloud_api';
                        c.bot_ia_active = true;
                        writePipeline.set(`candidate:${id}`, JSON.stringify(c));
                        writes++;
                    } else {
                        skipped++;
                    }
                } catch (e) {}
            });

            if (writes > 0) {
                await writePipeline.exec();
                migrated += writes;
            }
        }

        await redis.del('stats:bot:last_calc');

        return res.status(200).json({
            success: true,
            total: allIds.length,
            migrated,
            skipped,
            message: `Done. ${migrated} candidates migrated from gateway_instance → meta_cloud_api. Delete /api/backfill-gateway.js when done.`
        });

    } catch (error) {
        console.error('Backfill error:', error);
        return res.status(500).json({ error: error.message });
    }
}
