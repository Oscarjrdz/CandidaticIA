import { getRedisClient, isProfileComplete, auditProfile } from './storage.js';

export const calculateBotStats = async () => {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const todayCount = await redis.get(`ai:proactive:count:${todayStr}`) || '0';
        let totalSent = await redis.get('ai:proactive:total_sent') || '0';
        const totalRecovered = await redis.get('ai:proactive:total_recovered') || '0';

        const inactiveStagesJson = await redis.get('bot_inactive_stages');
        const inactiveStages = inactiveStagesJson ? JSON.parse(inactiveStagesJson) : [
            { hours: 24, label: 'Recordatorio (Lic. Brenda)' },
            { hours: 48, label: 'Re-confirmación interés' },
            { hours: 72, label: 'Último aviso de vacante' },
            { hours: 168, label: 'Limpieza de base' }
        ];

        let pendingCount = 0;
        let completeCount = 0;

        const flightPlan = inactiveStages.reduce((acc, s) => {
            acc[s.hours] = { label: s.label, total: 0, sent: 0, percentage: 0 };
            return acc;
        }, {});

        const now = new Date();
        const todayStart = new Date(now.getTime());
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now.getTime());
        todayEnd.setHours(23, 59, 59, 999);

        const customFieldsJson = await redis.get('custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

        const allIds = await redis.zrevrange('candidates:list', 0, -1);

        if (allIds && allIds.length > 0) {
            const CHUNK_SIZE = 100;
            for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
                const chunk = allIds.slice(i, i + CHUNK_SIZE);
                const pipeline = redis.pipeline();
                chunk.forEach(id => {
                    pipeline.get(`candidate:${id}`);
                });

                const candidateResults = await pipeline.exec();

                // Pipeline for session keys
                const sessionKeyPipeline = redis.pipeline();
                const processedCandidates = [];

                candidateResults.forEach(([err, res], idx) => {
                    if (!err && res) {
                        try {
                            const c = JSON.parse(res);

                            // [IRON-CLAD QUALITY SHIELD] Use auditProfile with a safety catch
                            let isComp = false;
                            try {
                                isComp = isProfileComplete(c, customFields);
                            } catch (e) {
                                console.error(`❌ [Audit Error] ID ${chunk[idx]}:`, e.message);
                                isComp = false; // Graceful degradation to incomplete
                            }

                            if (isComp) {
                                completeCount++;
                            } else {
                                pendingCount++;

                                const tUser = new Date(c.lastUserMessageAt || 0).getTime();
                                const tBot = new Date(c.lastBotMessageAt || 0).getTime();
                                const lastInteraction = new Date(Math.max(tUser, tBot));
                                const hoursInactive = (now - lastInteraction) / (1000 * 60 * 60);

                                const sortedStages = [...inactiveStages].sort((a, b) => b.hours - a.hours);
                                const currentStage = sortedStages.find(s => hoursInactive >= s.hours);

                                if (currentStage) {
                                    const level = currentStage.hours;
                                    const dueTime = new Date(lastInteraction.getTime() + (level * 60 * 60 * 1000));

                                    if (dueTime <= todayEnd) {
                                        const sessionKey = `proactive:${c.id}:${level}:${c.lastUserMessageAt}`;
                                        sessionKeyPipeline.get(sessionKey);
                                        processedCandidates.push({ c, level });
                                    }
                                }
                            }
                        } catch (parseErr) {
                            console.error(`❌ [Stats Parse Error] ID ${chunk[idx]}:`, parseErr.message);
                        }
                    }
                });

                const sessionResults = await sessionKeyPipeline.exec();

                // Final Pass: Update flightPlan
                const utcToday = new Date().toISOString().split('T')[0];

                processedCandidates.forEach((item, idx) => {
                    const { level } = item;
                    flightPlan[level].total++;
                    const sessionItem = sessionResults[idx];

                    if (sessionItem && !sessionItem[0] && sessionItem[1]) {
                        const sRes = sessionItem[1];
                        if (sRes !== 'sent') {
                            try {
                                const sentDate = new Date(sRes);
                                if (sentDate.toISOString().split('T')[0] === utcToday) {
                                    flightPlan[level].sent++;
                                }
                            } catch (e) { }
                        }
                    }
                });
            }
        }

        // --- Consistency Guard ---
        const totalCalculated = completeCount + pendingCount;

        // Calculate percentages and summary
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
            version: '1.2.8-TOTAL-SYNC',
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

        return result;

    } catch (error) {
        console.error('❌ [Stats Engine] Fatal Error:', error);
        return null;
    }
};
