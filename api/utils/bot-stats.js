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
                    inactiveStages.forEach(s => {
                        pipeline.get(`proactive:${id}:${s.hours}:${todayStr}`);
                    });
                });

                const results = await pipeline.exec();
                let resultIdx = 0;

                for (let j = 0; j < chunk.length; j++) {
                    const [err, res] = results[resultIdx++];
                    const sentKeysResults = results.slice(resultIdx, resultIdx + inactiveStages.length);
                    resultIdx += inactiveStages.length;

                    if (!err && res) {
                        try {
                            const c = JSON.parse(res);
                            const isComp = isProfileComplete(c, customFields);

                            if (isComp) {
                                completeCount++;
                            } else {
                                pendingCount++;

                                const lastInteraction = new Date(c.ultimoMensaje || c.primerContacto || c.createdAt || 0);

                                inactiveStages.forEach((s, sIdx) => {
                                    const dueTime = new Date(lastInteraction.getTime() + (s.hours * 60 * 60 * 1000));

                                    if (dueTime >= todayStart && dueTime <= todayEnd) {
                                        flightPlan[s.hours].total++;
                                        const [sentErr, sentRes] = sentKeysResults[sIdx];
                                        if (!sentErr && sentRes) {
                                            flightPlan[s.hours].sent++;
                                        }
                                    }
                                });
                            }
                        } catch (parseErr) { }
                    }
                }
            }

            // Calculate percentages
            Object.keys(flightPlan).forEach(h => {
                const p = flightPlan[h];
                p.percentage = p.total > 0 ? Math.round((p.sent / p.total) * 100) : 0;
            });
        }

        return {
            today: parseInt(todayCount),
            totalSent: parseInt(totalSent),
            totalRecovered: parseInt(totalRecovered),
            pending: pendingCount,
            complete: completeCount,
            flightPlan
        };

    } catch (error) {
        console.error('Error calculating bot stats:', error);
        return null;
    }
};
