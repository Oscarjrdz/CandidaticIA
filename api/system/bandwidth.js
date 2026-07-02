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

        // All dates in Monterrey time (America/Monterrey = UTC-6, sin DST desde 2023)
        const now = new Date();
        const mtyFmt = (opts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Monterrey', ...opts }).format(now);
        const yearMonthDay = mtyFmt({ year: 'numeric', month: '2-digit', day: '2-digit' }); // YYYY-MM-DD
        const yearMonth = yearMonthDay.substring(0, 7); // YYYY-MM
        const monthKey = `stats:bandwidth:${yearMonth}:total`;

        // Build list of every day in the current month. Future days resolve to 0
        // so the chart keeps a stable 28/29/30/31-day layout from day one.
        const year = parseInt(yearMonthDay.substring(0, 4), 10);
        const month = parseInt(yearMonthDay.substring(5, 7), 10) - 1; // 0-indexed
        const today = parseInt(yearMonthDay.substring(8, 10), 10);
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const dayKeys = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dd = String(d).padStart(2, '0');
            const mm = String(month + 1).padStart(2, '0');
            dayKeys.push(`stats:bandwidth:${year}-${mm}-${dd}:total`);
        }

        // Fetch monthly total and all daily keys in one mget
        const allKeys = [monthKey, ...dayKeys];
        const values = await redis.mget(...allKeys);

        const usedBytes = values[0] ? parseInt(values[0], 10) : 0;

        const daily = [];
        for (let i = 0; i < daysInMonth; i++) {
            daily.push({
                day: i + 1,
                bytes: values[i + 1] ? parseInt(values[i + 1], 10) : 0
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
            today,
            daysInMonth,
            daily
        });

    } catch (error) {
        console.error('❌ API Bandwidth Error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
