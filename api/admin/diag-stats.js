import { getRedisClient } from '../utils/storage.js';
import { calculateBotStats } from '../utils/bot-stats.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    const cCached = await redis.get('stats:bot:complete');
    const pCached = await redis.get('stats:bot:pending');

    console.log('--- STATS DIAGNOSTIC ---');
    console.log('Complete Cache:', cCached);
    console.log('Pending Cache:', pCached);

    // Force a calculation now
    console.log('Forcing calculateBotStats()...');
    const result = await calculateBotStats();

    const cNew = await redis.get('stats:bot:complete');
    const pNew = await redis.get('stats:bot:pending');

    return res.status(200).json({
        before: { complete: cCached, pending: pCached },
        after: { complete: cNew, pending: pNew },
        fullResult: result ? { complete: result.complete, pending: result.pending } : 'failed'
    });
}
