/**
 * API: Get Redis Bandwidth Usage
 * Returns Redis Cloud official monthly network usage.
 */
import { getRedisClient, validateAdminSession } from '../utils/storage.js';
import { readRedisCloudOfficialUsage } from '../utils/redis-cloud-official.js';

const TZ = 'America/Monterrey';
const FALLBACK_LIMIT_BYTES = 200 * 1024 * 1024 * 1024;

function todayMtyParts() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day)
    };
}

function dateKey({ year, month, day }) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dailySnapshotKey(day) {
    return `stats:redis_cloud_official:${day}:start_bytes`;
}

async function readOfficialDailySeries(redis, currentDate, officialUsedBytes) {
    if (!redis) return [];

    const daysInMonth = new Date(currentDate.year, currentDate.month, 0).getDate();
    const todayKey = dateKey(currentDate);
    const todayStartKey = dailySnapshotKey(todayKey);

    const existingTodayStart = await redis.get(todayStartKey);
    if (existingTodayStart === null) {
        await redis.set(todayStartKey, String(officialUsedBytes), 'EX', 90 * 24 * 60 * 60);
    }

    const dayKeys = [];
    for (let day = 1; day <= daysInMonth; day++) {
        dayKeys.push(dailySnapshotKey(dateKey({ ...currentDate, day })));
    }
    const startValues = await redis.mget(...dayKeys);

    const daily = [];
    for (let index = 0; index < daysInMonth; index++) {
        const day = index + 1;
        const startBytes = Number(startValues[index] || 0);
        const nextStartBytes = Number(startValues[index + 1] || 0);
        let bytes = 0;

        if (day < currentDate.day && startBytes > 0 && nextStartBytes > 0) {
            bytes = Math.max(0, nextStartBytes - startBytes);
        } else if (day === currentDate.day && startBytes > 0) {
            bytes = Math.max(0, officialUsedBytes - startBytes);
        }

        daily.push({
            day,
            bytes,
            source: 'redis_cloud_official_snapshot'
        });
    }

    return daily;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    try {
        const official = await readRedisCloudOfficialUsage();
        const currentDate = todayMtyParts();
        const month = `${currentDate.year}-${String(currentDate.month).padStart(2, '0')}`;
        const daysInMonth = new Date(currentDate.year, currentDate.month, 0).getDate();

        res.setHeader('Cache-Control', 'private, max-age=60');

        if (!official.available) {
            return res.status(200).json({
                success: true,
                officialAvailable: false,
                source: 'redis_cloud_official',
                reason: official.reason || 'unavailable',
                usedBytes: 0,
                limitBytes: FALLBACK_LIMIT_BYTES,
                percentage: 0,
                month,
                today: currentDate.day,
                daysInMonth,
                daily: [],
                dataQuality: {
                    status: 'official_unavailable',
                    source: 'redis_cloud_official',
                    reason: official.reason || 'unavailable'
                }
            });
        }

        const limitBytes = official.limitBytes || FALLBACK_LIMIT_BYTES;
        const redis = getRedisClient();
        const daily = await readOfficialDailySeries(redis, currentDate, official.usedBytes);
        return res.status(200).json({
            success: true,
            officialAvailable: true,
            source: 'redis_cloud_official',
            usedBytes: official.usedBytes,
            limitBytes,
            percentage: official.usedBytes > 0 ? (official.usedBytes / limitBytes) * 100 : 0,
            month,
            today: currentDate.day,
            daysInMonth,
            daily,
            dataQuality: {
                status: 'official',
                source: 'redis_cloud_official',
                database: official.database || null,
                subscription: official.subscription || null
            }
        });

    } catch (error) {
        console.error('❌ API Bandwidth Error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
