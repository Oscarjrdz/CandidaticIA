import { getRedisClient, getCandidates, syncCandidateStats } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { secret } = req.query;
    if (secret !== 'oscar-simple-stats-2024') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('🚀 Starting Server-Side Simple Stats Migration...');
        const redis = getRedisClient();
        if (!redis) {
            return res.status(500).json({ error: 'Redis client not available' });
        }

        // 1. Clear existing sets to start fresh
        await redis.del('stats:list:complete');
        await redis.del('stats:list:pending');

        // 2. Fetch all candidates (Atomic zcard)
        const totalCount = await redis.zcard('candidates:list');

        const limit = 100;
        let offset = 0;
        let processed = 0;

        while (offset < totalCount) {
            const { candidates } = await getCandidates(limit, offset);
            if (!candidates || candidates.length === 0) break;

            for (const c of candidates) {
                await syncCandidateStats(c.id, c);
                processed++;
            }
            offset += limit;
        }

        // 3. Final Verification
        const finalComplete = await redis.scard('stats:list:complete');
        const finalPending = await redis.scard('stats:list:pending');

        return res.status(200).json({
            success: true,
            message: 'Migration Finished',
            processed,
            complete: finalComplete,
            pending: finalPending,
            sum: finalComplete + finalPending,
            totalCount,
            consistent: (finalComplete + finalPending === totalCount)
        });

    } catch (error) {
        console.error('❌ Server-side migration failed:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
