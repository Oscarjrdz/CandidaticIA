/**
 * API: Get Redis Bandwidth Usage
 * Returns the current month's aggregated bandwidth usage + daily breakdown.
 */
import { getRedisClient, validateAdminSession } from '../utils/storage.js';
import { readBandwidthTelemetry } from '../utils/bandwidth-telemetry.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis client not initialized' });

        const telemetry = await readBandwidthTelemetry(redis);
        res.setHeader('Cache-Control', 'private, max-age=60');
        return res.status(200).json(telemetry);

    } catch (error) {
        console.error('❌ API Bandwidth Error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
