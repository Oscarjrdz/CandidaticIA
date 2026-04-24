/**
 * API: Get Redis Bandwidth Usage
 * Returns the current month's aggregated bandwidth usage.
 */
import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis client not initialized' });

        const now = new Date();
        const yearMonth = now.toISOString().substring(0, 7); // YYYY-MM
        const monthKey = `stats:bandwidth:${yearMonth}:total`;

        // We fetch the monthly aggregated bytes from Redis
        const usedBytesStr = await redis.get(monthKey);
        const usedBytes = usedBytesStr ? parseInt(usedBytesStr, 10) : 0;

        // Hard limit is 100 GB in bytes
        const LIMIT_GB = 100;
        const limitBytes = LIMIT_GB * 1024 * 1024 * 1024; // 107,374,182,400

        // If usedBytes is 0, let's just trigger a manual cron execution in the background
        // so that the first snapshot happens immediately if it hasn't already.
        if (usedBytes === 0) {
            fetch(`https://${req.headers.host || 'localhost:3000'}/api/cron/bandwidth-tracker`, {
                method: 'GET',
                headers: { 'x-vercel-cron': '1' }
            }).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            usedBytes,
            limitBytes,
            percentage: usedBytes > 0 ? (usedBytes / limitBytes) * 100 : 0,
            month: yearMonth
        });

    } catch (error) {
        console.error('❌ API Bandwidth Error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
