import { getRedisClient } from './storage.js';

/**
 * Bot Stats Engine v3.1 — Pure Atomic Reads
 *
 * Reads only O(1) counters. No candidate scan, ever.
 * - unread   → stats:bot:unread_v2  (INCR/DECR mantenido en tiempo real)
 * - complete / pending → SCARD (O(1))
 * - proactive counters → single GET each
 *
 * Bandwidth: ~10 MB/month
 */

const CACHE_TTL_MS    = 5 * 60 * 1000; // 5 min
const CACHE_RESULT_KEY = 'stats:bot:cached_result';
const CACHE_LAST_CALC_KEY = 'stats:bot:last_calc';

export const calculateBotStats = async () => {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const now = Date.now();

        // Return cached result if fresh (< 5 min)
        const [cachedRaw, lastCalcRaw] = await Promise.all([
            redis.get(CACHE_RESULT_KEY),
            redis.get(CACHE_LAST_CALC_KEY),
        ]);

        if (cachedRaw && lastCalcRaw && (now - parseInt(lastCalcRaw)) < CACHE_TTL_MS) {
            return JSON.parse(cachedRaw);
        }

        // Read all stats atomically — 6 keys, ~200 bytes total
        const todayStr = new Date().toISOString().split('T')[0];
        const pipeline = redis.pipeline();
        pipeline.get(`ai:proactive:count:${todayStr}`);
        pipeline.get('ai:proactive:total_sent');
        pipeline.get('ai:proactive:total_recovered');
        pipeline.scard('stats:list:complete');
        pipeline.scard('stats:list:pending');
        pipeline.get('stats:bot:unread_v2');
        const results = await pipeline.exec();

        const complete = results[3][1] || 0;
        const pending  = results[4][1] || 0;

        const result = {
            version:        '3.1.0-ATOMIC',
            today:          parseInt(results[0][1] || '0'),
            totalSent:      parseInt(results[1][1] || '0'),
            totalRecovered: parseInt(results[2][1] || '0'),
            complete,
            pending,
            total:          complete + pending,
            unread:         parseInt(results[5][1] || '0'),
            flightPlan:     {},
        };

        // Cache for 5 min
        await redis.pipeline()
            .set(CACHE_RESULT_KEY, JSON.stringify(result), 'EX', 300)
            .set(CACHE_LAST_CALC_KEY, now.toString())
            .exec();

        return result;

    } catch (error) {
        console.error('❌ [Stats Engine v3.1] Error:', error);
        return null;
    }
};
