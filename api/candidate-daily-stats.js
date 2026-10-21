import { getCandidates, validateAdminSession, getRedisClient } from './utils/storage.js';

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

const INIT_MARKER = 'stats:daily:captures:initialized';
const BACKFILL_LOCK_KEY = 'stats:daily:captures:backfill_lock';

// Backfill ÚNICO: escanea toda la base una sola vez, escribe los conteos ABSOLUTOS por día en el
// hash stats:daily:captures (HSET, idempotente) y prende el marcador. A partir de ahí el endpoint
// sirve siempre desde ese hash barato; el incremento en vivo (storage.saveCandidate → hincrby con
// createdAt||primerContacto en zona Monterrey) lo mantiene al día. Usa los MISMOS criterios de
// fecha que el incremento en vivo para no desalinearse. Protegido por lock para que dos instancias
// serverless no escaneen los ~13.6k blobs (~14 MB) a la vez. Devuelve true si este proceso lo hizo.
async function backfillDailyCaptures(redis) {
    const gotLock = await redis.set(BACKFILL_LOCK_KEY, '1', 'NX', 'EX', 180).catch(() => null);
    if (!gotLock) return false; // otra instancia ya lo está haciendo
    try {
        const { candidates } = await getCandidates(100000, 0, '', false);
        const counts = {};
        for (const c of candidates) {
            const raw = c.createdAt || c.primerContacto;
            if (!raw) continue;
            try {
                const key = toMtyDate(raw);
                counts[key] = (counts[key] || 0) + 1;
            } catch {}
        }
        const pipe = redis.pipeline();
        pipe.del(HASH_KEY);
        const flat = [];
        for (const [k, v] of Object.entries(counts)) flat.push(k, String(v));
        if (flat.length) pipe.hset(HASH_KEY, ...flat);
        pipe.set(INIT_MARKER, '1');
        await pipe.exec();
        return true;
    } finally {
        await redis.del(BACKFILL_LOCK_KEY).catch(() => {});
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const toStr   = req.query.to   || todayMty();
    const fromStr = req.query.from || addDays(toStr, -6);

    if (fromStr > toStr) return res.status(400).json({ error: 'Fechas inválidas' });

    const redis = getRedisClient();

    // Fast path: Redis hash. La PRIMERA vez que corre tras un deploy el marcador no existe, así que
    // se dispara el backfill único (detrás de lock); de ahí en adelante siempre sirve desde el hash.
    if (redis) {
        try {
            let initialized = await redis.exists(INIT_MARKER);
            if (!initialized) {
                const did = await backfillDailyCaptures(redis);
                initialized = did || (await redis.exists(INIT_MARKER));
            }
            if (initialized) {
                const hash = await redis.hgetall(HASH_KEY) || {};
                const days = buildDayArray(fromStr, toStr, hash);
                const total = days.reduce((s, d) => s + d.count, 0);
                res.setHeader('Cache-Control', 'private, max-age=60');
                return res.status(200).json({ days, total, from: fromStr, to: toStr, source: 'hash' });
            }
        } catch {}
    }

    // Fallback: escaneo completo (solo si el backfill lo tomó otra instancia y aún no termina).
    const fallbackCacheKey = `${fromStr}:${toStr}`;
    const cached = fallbackRangeCache.get(fallbackCacheKey);
    if (cached && cached.expiresAt > Date.now()) {
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
    res.setHeader('X-Candidatic-Cache', 'MISS');
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(payload);
}
