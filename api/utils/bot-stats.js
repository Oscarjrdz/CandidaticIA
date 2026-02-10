import { getRedisClient } from './storage.js';

/**
 * [SIN TANTO ROLLO] Optimized Stats Engine
 * Uses Redis Sets for O(1) counting of Complete/Pending candidates.
 * Only audits Pending candidates for the Flight Plan, making it extremely fast.
 */
export const calculateBotStats = async () => {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const todayCount = await redis.get(`ai:proactive:count:${todayStr}`) || '0';
        const totalSent = await redis.get('ai:proactive:total_sent') || '0';
        const totalRecovered = await redis.get('ai:proactive:total_recovered') || '0';

        // 1. Instant O(1) Counts from specialized sets
        const completeCount = await redis.scard('stats:list:complete');
        const pendingCount = await redis.scard('stats:list:pending');
        const totalCalculated = completeCount + pendingCount;

        // 2. Flight Plan Logic (Optimized: Only process Pending candidates)
        const inactiveStagesJson = await redis.get('bot_inactive_stages');
        const inactiveStages = inactiveStagesJson ? JSON.parse(inactiveStagesJson) : [
            { hours: 24, label: 'Recordatorio (Lic. Brenda)' },
            { hours: 48, label: 'Re-confirmación interés' },
            { hours: 72, label: 'Último aviso de vacante' },
            { hours: 168, label: 'Limpieza de base' }
        ];

        const flightPlan = inactiveStages.reduce((acc, s) => {
            acc[s.hours] = { label: s.label, total: 0, sent: 0, percentage: 0 };
            return acc;
        }, {});

        const now = Date.now();
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const utcToday = new Date().toISOString().split('T')[0];

        // Fetch all pending IDs (Flight plan candidates only live here)
        const pendingIds = await redis.smembers('stats:list:pending');

        if (pendingIds && pendingIds.length > 0) {
            const CHUNK_SIZE = 100;
            for (let i = 0; i < pendingIds.length; i += CHUNK_SIZE) {
                const chunk = pendingIds.slice(i, i + CHUNK_SIZE);
                const pipeline = redis.pipeline();
                chunk.forEach(id => pipeline.get(`candidate:${id}`));

                const results = await pipeline.exec();
                const sessionKeyPipeline = redis.pipeline();
                const processedInChunk = [];

                results.forEach(([err, res]) => {
                    if (err || !res) return;
                    try {
                        const c = JSON.parse(res);
                        const tUser = new Date(c.lastUserMessageAt || 0).getTime();
                        const tBot = new Date(c.lastBotMessageAt || 0).getTime();
                        const lastInteraction = Math.max(tUser, tBot);
                        const hoursInactive = (now - lastInteraction) / (1000 * 60 * 60);

                        const sortedStages = [...inactiveStages].sort((a, b) => b.hours - a.hours);
                        const currentStage = sortedStages.find(s => hoursInactive >= s.hours);

                        if (currentStage) {
                            const level = currentStage.hours;
                            const dueTime = lastInteraction + (level * 60 * 60 * 1000);

                            if (dueTime <= todayEnd.getTime()) {
                                const sessionKey = `proactive:${c.id}:${level}:${c.lastUserMessageAt}`;
                                sessionKeyPipeline.get(sessionKey);
                                processedInChunk.push({ level });
                            }
                        }
                    } catch (e) { }
                });

                const sessionResults = await sessionKeyPipeline.exec();
                processedInChunk.forEach((item, idx) => {
                    const { level } = item;
                    flightPlan[level].total++;
                    const sItem = sessionResults[idx];
                    if (sItem && !sItem[0] && sItem[1]) {
                        const sRes = sItem[1];
                        if (sRes !== 'sent') {
                            try {
                                if (new Date(sRes).toISOString().split('T')[0] === utcToday) {
                                    flightPlan[level].sent++;
                                }
                            } catch (e) { }
                        }
                    }
                });
            }
        }

        // Summary calculations
        let totalFlightPlanSent = 0;
        let totalFlightPlanTarget = 0;
        Object.keys(flightPlan).forEach(h => {
            const p = flightPlan[h];
            p.percentage = p.total > 0 ? Math.round((p.sent / p.total) * 100) : 0;
            totalFlightPlanTarget += p.total;
            totalFlightPlanSent += p.sent;
        });
        flightPlan.summary = { totalItems: totalFlightPlanTarget, totalSent: totalFlightPlanSent };

        const result = {
            version: '1.3.0-SIMPLE-SETS',
            today: parseInt(todayCount),
            totalSent: parseInt(totalSent),
            totalRecovered: parseInt(totalRecovered),
            pending: pendingCount,
            complete: completeCount,
            total: totalCalculated,
            flightPlan
        };

        // Cache for SSE/Live Dashboard
        await redis.set('stats:bot:complete', completeCount);
        await redis.set('stats:bot:pending', pendingCount);
        await redis.set('stats:bot:total', totalCalculated);
        await redis.set('stats:bot:version', result.version);
        await redis.set('stats:bot:flight_plan', JSON.stringify(flightPlan));
        await redis.set('stats:bot:last_calc', now.toString());

        return result;

    } catch (error) {
        console.error('❌ [Stats Engine] Fatal Error:', error);
        return null;
    }
};
