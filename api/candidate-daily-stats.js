import { getCandidates, validateAdminSession, getRedisClient } from './utils/storage.js';
import { estimateJsonBytes, recordUsageMetric } from './utils/usage-metrics.js';

const TZ = 'America/Monterrey';
const HASH_KEY = 'stats:daily:captures';
const fallbackRangeCache = new Map();
const FALLBACK_CACHE_TTL_MS = 5 * 60 * 1000;

function toMtyDate(isoString) {
    return new Date(isoString).toLocaleDateString('sv-SE', { timeZone: TZ });
}

function todayMty() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

function addDays(ymdStr, n) {
    const d = new Date(ymdStr + 'T12:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

function buildDayArray(fromStr, toStr, counts) {
    const days = [];
    let cur = fromStr;
    while (cur <= toStr) {
        const d = new Date(cur + 'T12:00:00.000Z');
        const wd = d.toLocaleDateString('es-MX', { timeZone: TZ, weekday: 'short' }).replace('.', '').slice(0, 2);
        const dayNum = parseInt(cur.split('-')[2]);
        const label = `${wd} ${dayNum}`;
        days.push({ date: cur, label, count: parseInt(counts[cur] || 0) });
        cur = addDays(cur, 1);
    }
    return days;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const toStr   = req.query.to   || todayMty();
    const fromStr = req.query.from || addDays(toStr, -6);

    if (fromStr > toStr) return res.status(400).json({ error: 'Fechas inválidas' });

    const redis = getRedisClient();

    // Fast path: Redis hash — only after backfill has run (marker key set)
    if (redis) {
        try {
            const initialized = await redis.exists('stats:daily:captures:initialized');
            if (initialized) {
                const hash = await redis.hgetall(HASH_KEY) || {};
                const days = buildDayArray(fromStr, toStr, hash);
                const total = days.reduce((s, d) => s + d.count, 0);
                const payload = { days, total, from: fromStr, to: toStr, source: 'hash' };
                recordUsageMetric(redis, '/api/candidate-daily-stats', {
                    responseBytes: estimateJsonBytes(payload)
                }).catch(() => {});
                return res.status(200).json(payload);
            }
        } catch {}
    }

    // Fallback: full scan (used until backfill is run once via POST /api/admin/backfill-daily-stats)
    const fallbackCacheKey = `${fromStr}:${toStr}`;
    const cached = fallbackRangeCache.get(fallbackCacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        recordUsageMetric(redis, '/api/candidate-daily-stats', {
            cacheHit: true,
            responseBytes: estimateJsonBytes(cached.payload)
        }).catch(() => {});
        res.setHeader('X-Candidatic-Cache', 'HIT');
        res.setHeader('Cache-Control', 'private, max-age=60');
        return res.status(200).json(cached.payload);
    }

    const { candidates } = await getCandidates(10000);
    const counts = {};
    for (const c of candidates) {
        const raw = c.createdAt || c.primerContacto;
        if (!raw) continue;
        try {
            const key = toMtyDate(raw);
            if (key < fromStr || key > toStr) continue;
            counts[key] = (counts[key] || 0) + 1;
        } catch {}
    }

    const days = buildDayArray(fromStr, toStr, counts);
    const total = days.reduce((s, d) => s + d.count, 0);
    const payload = { days, total, from: fromStr, to: toStr, source: 'scan' };
    if (fallbackRangeCache.size > 50) {
        const firstKey = fallbackRangeCache.keys().next().value;
        if (firstKey) fallbackRangeCache.delete(firstKey);
    }
    fallbackRangeCache.set(fallbackCacheKey, { expiresAt: Date.now() + FALLBACK_CACHE_TTL_MS, payload });
    recordUsageMetric(redis, '/api/candidate-daily-stats', {
        cacheMiss: true,
        fullScan: true,
        candidateReads: candidates.length,
        estimatedRedisBytes: estimateJsonBytes(candidates),
        responseBytes: estimateJsonBytes(payload)
    }).catch(() => {});
    res.setHeader('X-Candidatic-Cache', 'MISS');
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(payload);
}
