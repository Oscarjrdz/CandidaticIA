/**
 * API: Get Redis Bandwidth Usage
 * Returns the current month's aggregated bandwidth usage + daily breakdown.
 */
import { getRedisClient, validateAdminSession } from '../utils/storage.js';

const TZ = 'America/Monterrey';
const LIMIT_GB = 200;

function todayMty() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis client not initialized' });

        const yearMonthDay = todayMty();
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
        const hourKeys = [];
        for (let h = 0; h < 24; h++) {
            const hh = String(h).padStart(2, '0');
            hourKeys.push(`stats:bandwidth:${yearMonthDay}:${hh}:total`);
        }

        // Fetch monthly total and all daily keys in one mget
        const allKeys = [monthKey, ...dayKeys, ...hourKeys];
        const values = await redis.mget(...allKeys);

        const usedBytes = values[0] ? parseInt(values[0], 10) : 0;

        const daily = [];
        for (let i = 0; i < daysInMonth; i++) {
            daily.push({
                day: i + 1,
                bytes: values[i + 1] ? parseInt(values[i + 1], 10) : 0
            });
        }
        const hourlyStart = 1 + daysInMonth;
        const hourly = [];
        for (let i = 0; i < 24; i++) {
            hourly.push({
                hour: i,
                bytes: values[hourlyStart + i] ? parseInt(values[hourlyStart + i], 10) : 0
            });
        }

        // Redis Cloud Essentials 1 GB plan includes 200 GB/month network.
        const limitBytes = LIMIT_GB * 1024 * 1024 * 1024;

        res.setHeader('Cache-Control', 'private, max-age=60');

        return res.status(200).json({
            success: true,
            usedBytes,
            limitBytes,
            percentage: usedBytes > 0 ? (usedBytes / limitBytes) * 100 : 0,
            month: yearMonth,
            today,
            daysInMonth,
            daily,
            hourly
        });

    } catch (error) {
        console.error('❌ API Bandwidth Error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
