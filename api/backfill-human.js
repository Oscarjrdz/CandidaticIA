/**
 * 🔧 ONE-TIME BACKFILL: Set lastHumanMessageAt for all candidates
 * created on or before April 22, 2026 so Rule 3 doesn't flag them.
 *
 * Usage: GET /api/backfill-human?confirm=yes
 * Delete this file after running it once.
 */
import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.query.confirm !== 'yes') {
        return res.status(200).json({
            message: 'Dry run. Add ?confirm=yes to execute.',
            description: 'This will set lastHumanMessageAt on all candidates created ≤ 2026-04-22'
        });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    const cutoffDate = new Date('2026-04-22T23:59:59.999Z').getTime();
    const backfillTimestamp = '2026-04-22T12:00:00.000Z'; // Neutral midday timestamp

    try {
        // Get ALL candidate IDs from both sets
        const [completeIds, pendingIds] = await Promise.all([
            redis.smembers('stats:list:complete'),
            redis.smembers('stats:list:pending')
        ]);

        const allIds = [...new Set([...completeIds, ...pendingIds])];
        let updated = 0;
        let skipped = 0;
        let alreadyHad = 0;

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

                    // Skip if already has human interaction tracked
                    if (c.lastHumanMessageAt) {
                        alreadyHad++;
                        return;
                    }

                    // Check creation date
                    const createdAt = c.primerContacto || c.createdAt || c.ultimoMensaje;
                    if (!createdAt) {
                        // No date info — backfill to be safe
                        c.lastHumanMessageAt = backfillTimestamp;
                        writePipeline.set(`candidate:${id}`, JSON.stringify(c));
                        writes++;
                        return;
                    }

                    const createdTime = new Date(createdAt).getTime();
                    if (createdTime <= cutoffDate) {
                        c.lastHumanMessageAt = backfillTimestamp;
                        writePipeline.set(`candidate:${id}`, JSON.stringify(c));
                        writes++;
                    } else {
                        skipped++;
                    }
                } catch (e) {
                    // Skip corrupt records
                }
            });

            if (writes > 0) {
                await writePipeline.exec();
                updated += writes;
            }
        }

        // Invalidate stats cache so the unread count recalculates
        await redis.del('stats:bot:last_calc');

        return res.status(200).json({
            success: true,
            total: allIds.length,
            updated,
            skipped,
            alreadyHad,
            message: `Backfill complete. ${updated} candidates now have lastHumanMessageAt. Delete /api/backfill-human.js when done.`
        });

    } catch (error) {
        console.error('Backfill error:', error);
        return res.status(500).json({ error: error.message });
    }
}
