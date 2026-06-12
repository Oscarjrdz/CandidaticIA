/**
 * API: Get Redis Bandwidth Usage
 * Returns the current month's aggregated bandwidth usage + daily breakdown.
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

        // Build list of days in the current month up to today
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth(); // 0-indexed
        const today = now.getUTCDate();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const totalDays = Math.min(today, daysInMonth);

        const dayKeys = [];
        for (let d = 1; d <= totalDays; d++) {
            const dd = String(d).padStart(2, '0');
            const mm = String(month + 1).padStart(2, '0');
            dayKeys.push(`stats:bandwidth:${year}-${mm}-${dd}:total`);
        }

        // Fetch monthly total and all daily keys in one pipeline
        const pipeline = redis.pipeline();
        pipeline.get(monthKey);
        dayKeys.forEach(k => pipeline.get(k));
        const results = await pipeline.exec();

        const usedBytesStr = results[0][1];
        const usedBytes = usedBytesStr ? parseInt(usedBytesStr, 10) : 0;

        const daily = [];
        for (let i = 0; i < totalDays; i++) {
            const raw = results[i + 1][1];
            daily.push({
                day: i + 1,
                bytes: raw ? parseInt(raw, 10) : 0
            });
        }

        // Hard limit is 100 GB in bytes
        const LIMIT_GB = 100;
        const limitBytes = LIMIT_GB * 1024 * 1024 * 1024;

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
            month: yearMonth,
            daily
        });

    } catch (error) {
        console.error('❌ API Bandwidth Error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
