/**
 * 📊 Vercel Cron: Redis Bandwidth Tracker
 * Executes hourly to snapshot Redis network usage and calculate robust deltas,
 * handling potential Redis server reboots automatically.
 */
import { getRedisClient } from '../utils/storage.js';
import { randomUUID } from 'crypto';

const LAST_ABSOLUTE_BYTES_KEY = 'stats:bandwidth:last_absolute_bytes';
const LAST_SNAPSHOT_AT_KEY = 'stats:bandwidth:last_snapshot_at';
const SNAPSHOT_LOCK_KEY = 'stats:bandwidth:snapshot_lock';
const MAX_REASONABLE_BYTES_PER_HOUR = Number(process.env.BANDWIDTH_MAX_BYTES_PER_HOUR || 600 * 1024 * 1024);
const TZ = 'America/Monterrey';

function parseRedisInfoNumber(info, field) {
    const line = info.split('\n').find(item => item.startsWith(`${field}:`));
    if (!line) return 0;

    const value = Number(line.split(':')[1]?.trim());
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

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

function hourMty() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}:${values.hour}`;
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Keep cron auth aligned with the other scheduled jobs.
    const cronSecret = globalThis.process?.env?.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    let redis;
    let lockToken;
    let lockAcquired = false;

    try {
        redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis client not initialized' });

        lockToken = randomUUID();
        const lockResult = await redis.set(SNAPSHOT_LOCK_KEY, lockToken, 'EX', 55, 'NX');
        lockAcquired = lockResult === 'OK';
        if (!lockAcquired) {
            return res.status(200).json({ success: true, skipped: 'Snapshot already in progress.' });
        }

        // 1. Fetch raw INFO stats
        const info = await redis.info('stats');
        const inputBytes = parseRedisInfoNumber(info, 'total_net_input_bytes');
        const outputBytes = parseRedisInfoNumber(info, 'total_net_output_bytes');

        const currentAbsoluteBytes = inputBytes + outputBytes;
        if (currentAbsoluteBytes === 0) {
            return res.status(200).json({ message: 'Zero bytes reported, skipping.' });
        }

        // 2. Fetch previous snapshot to calculate delta
        const [prevBytesStr, prevSnapshotAtStr] = await redis.mget(LAST_ABSOLUTE_BYTES_KEY, LAST_SNAPSHOT_AT_KEY);
        const prevAbsoluteBytes = prevBytesStr ? parseInt(prevBytesStr, 10) : null;
        const prevSnapshotAt = prevSnapshotAtStr ? parseInt(prevSnapshotAtStr, 10) : null;
        const snapshotAt = Date.now();

        if (!Number.isFinite(prevAbsoluteBytes)) {
            await redis.mset(LAST_ABSOLUTE_BYTES_KEY, currentAbsoluteBytes, LAST_SNAPSHOT_AT_KEY, snapshotAt);
            return res.status(200).json({
                success: true,
                initialized: true,
                message: 'Baseline initialized; next snapshot will calculate deltas.',
                snapshot: {
                    currentAbsoluteBytes,
                    deltaBytes: 0
                }
            });
        }

        let deltaBytes = 0;
        if (currentAbsoluteBytes < prevAbsoluteBytes) {
            // Redis server was restarted/flushed, the counter reset.
            deltaBytes = currentAbsoluteBytes;
        } else {
            // Normal operation
            deltaBytes = currentAbsoluteBytes - prevAbsoluteBytes;
        }

        const elapsedHours = Number.isFinite(prevSnapshotAt)
            ? Math.max((snapshotAt - prevSnapshotAt) / (60 * 60 * 1000), 1)
            : 1;
        const maxReasonableDelta = MAX_REASONABLE_BYTES_PER_HOUR * Math.ceil(elapsedHours);
        const suspiciousDelta = deltaBytes > maxReasonableDelta;

        // 3. Persist the new absolute value even for suspicious spikes so one bad
        // sample does not get charged repeatedly on every cron run.
        await redis.mset(LAST_ABSOLUTE_BYTES_KEY, currentAbsoluteBytes, LAST_SNAPSHOT_AT_KEY, snapshotAt);

        // 4. Update Daily and Monthly aggregations using atomic INCRBY.
        const yearMonthDay = todayMty();
        const yearMonth = yearMonthDay.substring(0, 7); // YYYY-MM

        const monthKey = `stats:bandwidth:${yearMonth}:total`;
        const dayKey = `stats:bandwidth:${yearMonthDay}:total`;
        const hourKey = `stats:bandwidth:${hourMty()}:total`;

        if (deltaBytes > 0 && !suspiciousDelta) {
            const pipeline = redis.pipeline();
            pipeline.incrby(monthKey, deltaBytes);
            pipeline.incrby(dayKey, deltaBytes);
            pipeline.incrby(hourKey, deltaBytes);
            
            // Set TTLs to auto-cleanup old data (keep daily for 60 days, monthly for 365 days)
            pipeline.expire(dayKey, 60 * 24 * 60 * 60);
            pipeline.expire(monthKey, 365 * 24 * 60 * 60);
            pipeline.expire(hourKey, 14 * 24 * 60 * 60);
            
            await pipeline.exec();
        } else if (suspiciousDelta) {
            const anomalyKey = `stats:bandwidth:anomaly:${yearMonthDay}:${snapshotAt}`;
            await redis.set(anomalyKey, JSON.stringify({
                currentAbsoluteBytes,
                prevAbsoluteBytes,
                deltaBytes,
                elapsedHours,
                maxReasonableDelta,
                snapshotAt
            }), 'EX', 60 * 24 * 60 * 60);
        }

        return res.status(200).json({
            success: true,
            skippedAggregation: suspiciousDelta ? 'suspicious_delta' : null,
            snapshot: {
                currentAbsoluteBytes,
                deltaBytes,
                maxReasonableDelta,
                monthKey,
                dayKey,
                hourKey
            }
        });

    } catch (error) {
        console.error('❌ Bandwidth Tracker Error:', error);
        return res.status(500).json({ error: error.message });
    } finally {
        if (redis && lockAcquired && lockToken) {
            try {
                const currentLock = await redis.get(SNAPSHOT_LOCK_KEY);
                if (currentLock === lockToken) await redis.del(SNAPSHOT_LOCK_KEY);
            } catch {
                // The lock has a short TTL; metrics must not fail because cleanup failed.
            }
        }
    }
}
