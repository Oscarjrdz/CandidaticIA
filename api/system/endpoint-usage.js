import { getRedisClient, validateAdminSession } from '../utils/storage.js';
import { readUsageMetrics } from '../utils/usage-metrics.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    try {
        const day = req.query.day || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
        const endpoints = await readUsageMetrics(redis, day);
        const totals = endpoints.reduce((acc, row) => {
            acc.calls += row.calls || 0;
            acc.cacheHits += row.cacheHits || 0;
            acc.cacheMisses += row.cacheMisses || 0;
            acc.candidateReads += row.candidateReads || 0;
            acc.messageReads += row.messageReads || 0;
            acc.responseBytes += row.responseBytes || 0;
            acc.estimatedRedisBytes += row.estimatedRedisBytes || 0;
            acc.fullScans += row.fullScans || 0;
            return acc;
        }, {
            calls: 0,
            cacheHits: 0,
            cacheMisses: 0,
            candidateReads: 0,
            messageReads: 0,
            responseBytes: 0,
            estimatedRedisBytes: 0,
            fullScans: 0,
        });

        return res.status(200).json({
            success: true,
            day,
            totals,
            endpoints
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
