import { getRedisClient, isProfileComplete } from './storage.js';

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
        let debugInfo = "";

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

                // Pass 2: Get session keys for the identified levels
                const sessionKeyPipeline = redis.pipeline();
                const processedCandidates = [];

                candidateResults.forEach(([err, res]) => {
                    if (!err && res) {
                        try {
                            const c = JSON.parse(res);
                            const isComp = isProfileComplete(c, customFields);

                            if (isComp) {
                                completeCount++;
                            } else {
                                pendingCount++;

                                const tUser = new Date(c.lastUserMessageAt || 0).getTime();
                                const tBot = new Date(c.lastBotMessageAt || 0).getTime();
                                const lastInteraction = new Date(Math.max(tUser, tBot));
                                const hoursInactive = (now - lastInteraction) / (1000 * 60 * 60);

                                const sortedStages = [...inactiveStages].sort((a, b) => b.hours - a.hours);

                                // Determine the HIGHEST level the candidate qualifies for
                                const currentStage = sortedStages.find(s => hoursInactive >= s.hours);

                                if (currentStage) {
                                    const level = currentStage.hours;
                                    const dueTime = new Date(lastInteraction.getTime() + (level * 60 * 60 * 1000));

                                    // Strictly count only if they became due today (to match "Today's Flight Plan")
                                    // Or if they were already due but for some reason we count them in today's quota
                                    // User said "cuantos de cada paso hoy voy a mandar solamente hoy"
                                    if (dueTime <= todayEnd) {
                                        const sessionKey = `proactive:${c.id}:${level}:${c.lastUserMessageAt}`;
                                        sessionKeyPipeline.get(sessionKey);
                                        processedCandidates.push({ c, level });
                                    }
                                }
                            }
                        } catch (parseErr) { }
                    }
                });

                const sessionResults = await sessionKeyPipeline.exec();

                // Final Pass: Update flightPlan
                const mxToday = new Date(new Date().getTime() - (6 * 3600000)).toISOString().split('T')[0];

                processedCandidates.forEach((item, idx) => {
                    const { level } = item;
                    flightPlan[level].total++;
                    const [sErr, sRes] = sessionResults[idx];

                    if (!sErr && sRes) {
                        // Check if sRes is 'sent' (legacy) or a timestamp
                        if (sRes === 'sent') {
                            // Legacy keys: We'll count them as sent today ONLY for the first transition phase
                            // Actually, legacy keys don't have date, so it's safer to skip or assume old.
                            // User wants it to be 0 if bot was off, so legacy 'sent' should be ignored for daily.
                        } else {
                            try {
                                const sentDate = new Date(sRes);
                                const sentMxStr = new Date(sentDate.getTime() - (6 * 3600000)).toISOString().split('T')[0];
                                if (sentMxStr === mxToday) {
                                    flightPlan[level].sent++;
                                }
                            } catch (e) {
                                // Fallback for corrupt data
                            }
                        }
                    }
                });
            }

            // Calculate percentages and summary
            let totalItems = 0;
            let totalSentItems = 0;
            Object.keys(flightPlan).forEach(h => {
                const p = flightPlan[h];
                p.percentage = p.total > 0 ? Math.round((p.sent / p.total) * 100) : 0;
                totalItems += p.total;
                totalSentItems += p.sent;
            });

            flightPlan.summary = { totalItems, totalSent: totalSentItems };
        }

        const result = {
            today: parseInt(todayCount),
            totalSent: parseInt(totalSent),
            totalRecovered: parseInt(totalRecovered),
            pending: pendingCount,
            complete: completeCount,
            flightPlan
        };

        // Cache for SSE/Live Dashboard
        await redis.set('stats:bot:complete', completeCount);
        await redis.set('stats:bot:pending', pendingCount);

        return result;

    } catch (error) {
        console.error('Error calculating bot stats:', error);
        return null;
    }
};
