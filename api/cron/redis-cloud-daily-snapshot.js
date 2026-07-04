/**
 * Vercel Cron: Redis Cloud official daily bandwidth snapshot.
 * Stores the official monthly counter at the beginning of the Monterrey day.
 */
import { getRedisClient } from '../utils/storage.js';
import { readRedisCloudOfficialUsage } from '../utils/redis-cloud-official.js';

const TZ = 'America/Monterrey';

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

function snapshotKey(day) {
    return `stats:redis_cloud_official:${day}:start_bytes`;
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const cronSecret = globalThis.process?.env?.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const official = await readRedisCloudOfficialUsage();
        if (!official.available) {
            return res.status(200).json({
                success: false,
                skipped: true,
                reason: official.reason || 'official_usage_unavailable'
            });
        }

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis client not initialized' });

        const day = todayMty();
        const key = snapshotKey(day);
        const created = await redis.set(key, String(official.usedBytes), 'EX', 90 * 24 * 60 * 60, 'NX');

        return res.status(200).json({
            success: true,
            day,
            key,
            created: created === 'OK',
            officialMonthlyBytes: official.usedBytes
        });
    } catch (error) {
        console.error('❌ Redis Cloud Daily Snapshot Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
