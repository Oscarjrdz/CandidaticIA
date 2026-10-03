/**
 * GET /api/vox/calls?limit=50
 *
 * Historial consolidado de llamadas de Vox: por cada llamada, la CONFIG usada (modelo, voz,
 * vacante, candidato/prueba, mensaje de cita, VAD) + el COSTO (tokens, MXN, peso/min).
 * Sirve para auditar picos: marca `spike: true` cuando el peso/min supera el límite guardado.
 *
 * El record vive en el hash `vox:session:<id>` (config la escribe session.js al iniciar;
 * costo lo acumula usage.js) e indexado por tiempo en el sorted set `vox:calls`.
 */

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

        // IDs de las llamadas más recientes primero.
        const ids = await redis.zrevrange('vox:calls', 0, limit - 1);
        if (!ids.length) return res.status(200).json({ success: true, calls: [] });

        const pipe = redis.pipeline();
        ids.forEach(id => pipe.hgetall(`vox:session:${id}`));
        const rows = await pipe.exec();

        const calls = ids.map((id, i) => {
            const h = (rows[i] && rows[i][1]) || {};
            const seconds = Number(h.seconds) || 0;
            const costUsd = Number(h.costUsd) || 0;
            const fxRate = Number(h.fxRate) || 18.5;
            const budget = Number(h.budgetMxnPerMin) || 1;
            const costMxn = costUsd * fxRate;
            const mxnPerMin = seconds > 0 ? costMxn / (seconds / 60) : 0;
            return {
                sessionId: id,
                startedAt: h.startedAt || '',
                model: h.model || '',
                voice: h.voice || '',
                vacancyName: h.vacancyName || '',
                candidateName: h.candidateName || '',
                isTest: h.isTest === '1',
                citaShortcut: h.citaShortcut || '',
                vadThreshold: h.vadThreshold || '',
                vadSilenceMs: h.vadSilenceMs || '',
                seconds,
                costUsd: Number(costUsd.toFixed(5)),
                costMxn: Number(costMxn.toFixed(4)),
                mxnPerMin: Number(mxnPerMin.toFixed(3)),
                budget,
                spike: mxnPerMin > budget,
                tokens: {
                    audioInput: Number(h.audioInput) || 0,
                    audioInputCached: Number(h.audioInputCached) || 0,
                    audioOutput: Number(h.audioOutput) || 0,
                    textInput: Number(h.textInput) || 0,
                    textInputCached: Number(h.textInputCached) || 0,
                    textOutput: Number(h.textOutput) || 0,
                },
            };
        });

        return res.status(200).json({ success: true, calls });
    } catch (error) {
        console.error('[vox/calls] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
