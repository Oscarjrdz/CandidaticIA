const METRICS_TTL_SECONDS = 60 * 60 * 24 * 14;

function todayMty() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
}

function safeNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function estimateJsonBytes(value) {
    if (value === undefined || value === null) return 0;
    try {
        return Buffer.byteLength(JSON.stringify(value));
    } catch {
        return 0;
    }
}

export async function recordUsageMetric(redis, endpoint, metrics = {}) {
    if (!redis || !endpoint) return;
    try {
        const day = todayMty();
        const key = `metrics:endpoint:${day}:${endpoint}`;
        const indexKey = `metrics:endpoint:${day}:index`;
        const pipe = redis.pipeline();
        pipe.sadd(indexKey, endpoint);
        pipe.expire(indexKey, METRICS_TTL_SECONDS);
        pipe.hincrby(key, 'calls', 1);

        const fields = {
            cacheHits: metrics.cacheHit ? 1 : 0,
            cacheMisses: metrics.cacheMiss ? 1 : 0,
            redisReads: metrics.redisReads,
            redisWrites: metrics.redisWrites,
            candidateReads: metrics.candidateReads,
            messageReads: metrics.messageReads,
            responseBytes: metrics.responseBytes,
            estimatedRedisBytes: metrics.estimatedRedisBytes,
            fullScans: metrics.fullScan ? 1 : 0,
        };

        Object.entries(fields).forEach(([field, value]) => {
            const n = safeNumber(value);
            if (n > 0) pipe.hincrby(key, field, n);
        });

        pipe.expire(key, METRICS_TTL_SECONDS);
        await pipe.exec();
    } catch (_) {
        // Metrics must never affect product behavior.
    }
}

export async function readUsageMetrics(redis, day = todayMty()) {
    if (!redis) return [];
    const indexKey = `metrics:endpoint:${day}:index`;
    const endpoints = await redis.smembers(indexKey).catch(() => []);
    if (!endpoints?.length) return [];

    const pipe = redis.pipeline();
    endpoints.forEach(endpoint => pipe.hgetall(`metrics:endpoint:${day}:${endpoint}`));
    const rows = await pipe.exec();

    return endpoints.map((endpoint, index) => {
        const raw = rows[index]?.[1] || {};
        const parsed = {};
        Object.entries(raw).forEach(([key, value]) => {
            parsed[key] = Number(value || 0);
        });
        const calls = parsed.calls || 0;
        return {
            endpoint,
            ...parsed,
            cacheHitRate: calls ? Number(((parsed.cacheHits || 0) / calls).toFixed(3)) : 0,
        };
    }).sort((a, b) => {
        const bBytes = (b.estimatedRedisBytes || 0) + (b.responseBytes || 0);
        const aBytes = (a.estimatedRedisBytes || 0) + (a.responseBytes || 0);
        return (bBytes || b.calls || 0) - (aBytes || a.calls || 0);
    });
}
