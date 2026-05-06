import { getRedisClient } from './storage.js';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 📊 Bot Stats Engine v3.0 — Dual-Path Architecture
 * ═══════════════════════════════════════════════════════════════════════
 *
 * FAST PATH  (every 5 min, ~1 KB):
 *   Reads only atomic counters + cached flight plan. No candidate scan.
 *   unread   → stats:bot:unread_v2  (INCR/DECR in real time)
 *   counts   → stats:list:complete / stats:list:pending  (SCARD, O(1))
 *   flight   → stats:bot:flight_plan  (cached from last reconciliation)
 *
 * RECONCILIATION PATH (every 60 min, ~3.4 MB):
 *   Full candidate scan to correct any counter drift and rebuild the
 *   flight plan + activity tracker from source of truth.
 *
 * BANDWIDTH: ~100 MB/month  vs ~329 GB/month (v1) vs ~5 GB/month (v2)
 * ═══════════════════════════════════════════════════════════════════════
 */

const FAST_CACHE_TTL_MS  = 5  * 60 * 1000;  // 5 min — fast-path result cache
const RECON_INTERVAL_MS  = 60 * 60 * 1000;  // 60 min — full scan interval

const CACHE_RESULT_KEY   = 'stats:bot:cached_result';
const CACHE_LAST_CALC_KEY = 'stats:bot:last_calc';
const LAST_RECON_KEY     = 'stats:bot:last_recon';
const ACTIVITY_TRACKER_KEY = 'activity:tracker';

// ─── FAST PATH ────────────────────────────────────────────────────────────────
async function fastPath(redis, now) {
    const todayStr = new Date().toISOString().split('T')[0];

    const pipeline = redis.pipeline();
    pipeline.get(`ai:proactive:count:${todayStr}`);
    pipeline.get('ai:proactive:total_sent');
    pipeline.get('ai:proactive:total_recovered');
    pipeline.scard('stats:list:complete');
    pipeline.scard('stats:list:pending');
    pipeline.get('stats:bot:unread_v2');
    pipeline.get('stats:bot:flight_plan');
    const results = await pipeline.exec();

    const complete = results[3][1] || 0;
    const pending  = results[4][1] || 0;

    const result = {
        version:        '3.0.0-FAST',
        today:          parseInt(results[0][1] || '0'),
        totalSent:      parseInt(results[1][1] || '0'),
        totalRecovered: parseInt(results[2][1] || '0'),
        complete,
        pending,
        total:          complete + pending,
        unread:         parseInt(results[5][1] || '0'),
        flightPlan:     results[6][1] ? JSON.parse(results[6][1]) : {},
    };

    // Cache fast result for 5 min
    await redis.pipeline()
        .set(CACHE_RESULT_KEY, JSON.stringify(result), 'EX', 300)
        .set(CACHE_LAST_CALC_KEY, now.toString())
        .exec();

    return result;
}

// ─── RECONCILIATION PATH ──────────────────────────────────────────────────────
async function reconcile(redis, now) {
    const todayStr  = new Date().toISOString().split('T')[0];
    const todayEnd  = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [todayCount, totalSent, totalRecovered] = await Promise.all([
        redis.get(`ai:proactive:count:${todayStr}`),
        redis.get('ai:proactive:total_sent'),
        redis.get('ai:proactive:total_recovered'),
    ]);

    const completeCount = await redis.scard('stats:list:complete');
    const pendingCount  = await redis.scard('stats:list:pending');

    const inactiveStagesJson = await redis.get('bot_inactive_stages');
    const inactiveStages = inactiveStagesJson ? JSON.parse(inactiveStagesJson) : [
        { hours: 24,  label: 'Recordatorio (Lic. Brenda)' },
        { hours: 48,  label: 'Re-confirmación interés' },
        { hours: 72,  label: 'Último aviso de vacante' },
        { hours: 168, label: 'Limpieza de base' },
    ];

    const flightPlan = inactiveStages.reduce((acc, s) => {
        acc[s.hours] = { label: s.label, total: 0, sent: 0, percentage: 0 };
        return acc;
    }, {});

    const pendingIds  = await redis.smembers('stats:list:pending')  || [];
    const completeIds = await redis.smembers('stats:list:complete') || [];
    let totalUnreadCount = 0;

    const allIdsToAudit = [
        ...pendingIds.map(id  => ({ id, isPending: true  })),
        ...completeIds.map(id => ({ id, isPending: false })),
    ];

    if (allIdsToAudit.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < allIdsToAudit.length; i += CHUNK_SIZE) {
            const chunk = allIdsToAudit.slice(i, i + CHUNK_SIZE);

            const pipeline = redis.pipeline();
            chunk.forEach(item => pipeline.get(`candidate:${item.id}`));
            const results = await pipeline.exec();

            const sessionKeyPipeline = redis.pipeline();
            const zaddPipeline       = redis.pipeline();
            const processedInChunk   = [];

            results.forEach(([err, res], idx) => {
                if (err || !res) return;
                const { isPending, id } = chunk[idx];
                try {
                    const c = JSON.parse(res);
                    const tUser = new Date(c.lastUserMessageAt || 0).getTime();
                    const tBot  = new Date(c.lastBotMessageAt  || 0).getTime();
                    const lastInteraction = Math.max(tUser, tBot);
                    const hoursInactive = (now - lastInteraction) / (1000 * 60 * 60);

                    if (lastInteraction > 0) {
                        zaddPipeline.zadd(ACTIVITY_TRACKER_KEY, lastInteraction, id);
                    }

                    let currentStage = null;
                    if (isPending) {
                        const sortedStages = [...inactiveStages].sort((a, b) => b.hours - a.hours);
                        currentStage = sortedStages.find(s => hoursInactive >= s.hours);
                    }

                    if (currentStage) {
                        const level   = currentStage.hours;
                        const dueTime = lastInteraction + (level * 60 * 60 * 1000);
                        if (dueTime <= todayEnd.getTime()) {
                            const sessionKey = `proactive:${c.id}:${level}:${c.lastUserMessageAt}`;
                            sessionKeyPipeline.get(sessionKey);
                            processedInChunk.push({ level, c });
                        } else {
                            processedInChunk.push({ level: null, c });
                        }
                    } else {
                        processedInChunk.push({ level: null, c });
                    }

                    // Unread count
                    if (c.unreadMsgCount > 0) {
                        totalUnreadCount++;
                    } else {
                        const userT  = Math.max(
                            c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0,
                            c.ultimoMensaje     ? new Date(c.ultimoMensaje).getTime()     : 0
                        );
                        const bestBotT = Math.max(
                            c.lastBotMessageAt   ? new Date(c.lastBotMessageAt).getTime()   : 0,
                            c.ultimoMensajeBot   ? new Date(c.ultimoMensajeBot).getTime()   : 0
                        );
                        if (userT > 0 && userT > (bestBotT + 1000)) totalUnreadCount++;
                        else if (userT > 0 && !c.lastHumanMessageAt) totalUnreadCount++;
                    }
                } catch (e) { }
            });

            await Promise.all([
                zaddPipeline.exec().catch(() => {}),
                (async () => {
                    const sessionResults = await sessionKeyPipeline.exec();
                    processedInChunk.forEach((item, idx) => {
                        const { level } = item;
                        if (level !== null && flightPlan[level]) flightPlan[level].total++;
                        const sItem = sessionResults[idx];
                        if (sItem && !sItem[0] && sItem[1] && sItem[1] !== 'sent') {
                            try {
                                const utcToday = new Date().toISOString().split('T')[0];
                                if (new Date(sItem[1]).toISOString().split('T')[0] === utcToday) {
                                    flightPlan[level].sent++;
                                }
                            } catch (e) { }
                        }
                    });
                })(),
            ]);
        }
    }

    await redis.expire(ACTIVITY_TRACKER_KEY, 5184000).catch(() => {});

    let totalFlightPlanSent = 0;
    let totalFlightPlanTarget = 0;
    Object.keys(flightPlan).forEach(h => {
        const p = flightPlan[h];
        p.percentage = p.total > 0 ? Math.round((p.sent / p.total) * 100) : 0;
        totalFlightPlanTarget += p.total;
        totalFlightPlanSent   += p.sent;
    });
    flightPlan.summary = { totalItems: totalFlightPlanTarget, totalSent: totalFlightPlanSent };

    const result = {
        version:        '3.0.0-RECON',
        today:          parseInt(todayCount || '0'),
        totalSent:      parseInt(totalSent || '0'),
        totalRecovered: parseInt(totalRecovered || '0'),
        pending:        pendingCount,
        complete:       completeCount,
        total:          completeCount + pendingCount,
        unread:         totalUnreadCount,
        flightPlan,
    };

    // Persist result + reconcile all atomic counters
    const cachePipeline = redis.pipeline();
    cachePipeline.set(CACHE_RESULT_KEY,        JSON.stringify(result), 'EX', 3600);
    cachePipeline.set(CACHE_LAST_CALC_KEY,     now.toString());
    cachePipeline.set(LAST_RECON_KEY,          now.toString());
    cachePipeline.set('stats:bot:complete',    completeCount);
    cachePipeline.set('stats:bot:pending',     pendingCount);
    cachePipeline.set('stats:bot:total',       completeCount + pendingCount);
    cachePipeline.set('stats:bot:unread_v2',   totalUnreadCount);
    cachePipeline.set('stats:bot:version',     result.version);
    cachePipeline.set('stats:bot:flight_plan', JSON.stringify(flightPlan));
    await cachePipeline.exec();

    return result;
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
export const calculateBotStats = async () => {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const now = Date.now();

        // 1. Return cached result if fresh (< 5 min)
        const [cachedRaw, lastCalcRaw] = await Promise.all([
            redis.get(CACHE_RESULT_KEY),
            redis.get(CACHE_LAST_CALC_KEY),
        ]);

        if (cachedRaw && lastCalcRaw && (now - parseInt(lastCalcRaw)) < FAST_CACHE_TTL_MS) {
            return JSON.parse(cachedRaw);
        }

        // 2. Check if full reconciliation is due (every 60 min)
        const lastReconRaw = await redis.get(LAST_RECON_KEY);
        const needsRecon   = !lastReconRaw || (now - parseInt(lastReconRaw)) >= RECON_INTERVAL_MS;

        if (needsRecon) {
            return await reconcile(redis, now);
        }

        // 3. Fast path: atomic counters only (~1 KB)
        return await fastPath(redis, now);

    } catch (error) {
        console.error('❌ [Stats Engine v3] Fatal Error:', error);
        return null;
    }
};
