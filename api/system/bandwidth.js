/**
 * GET /api/system/bandwidth
 * Devuelve el consumo real de ancho de banda de Redis (bytes de red reales,
 * medidos con INFO stats — no un estimado de payloads de la app).
 * Ver api/utils/redis-bandwidth.js para como se calcula.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');
        const { getBandwidthSummary } = await import('../utils/redis-bandwidth.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
        const summary = await getBandwidthSummary(redis, days);

        return res.status(200).json({ success: true, ...summary });
    } catch (error) {
        console.error('[bandwidth] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
