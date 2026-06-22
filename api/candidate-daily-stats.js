import { getCandidates, validateAdminSession, getRedisClient } from './utils/storage.js';

const TZ = 'America/Monterrey';
const HASH_KEY = 'stats:daily:captures';

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
        const label = d.toLocaleDateString('es-MX', { timeZone: TZ, weekday: 'short', day: 'numeric' });
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

    // Fast path: Redis hash O(1) per field — populated by saveCandidate + backfill
    if (redis) {
        try {
            const hash = await redis.hgetall(HASH_KEY);
            if (hash && Object.keys(hash).length > 0) {
                const days = buildDayArray(fromStr, toStr, hash);
                const total = days.reduce((s, d) => s + d.count, 0);
                return res.status(200).json({ days, total, from: fromStr, to: toStr, source: 'hash' });
            }
        } catch {}
    }

    // Fallback: full scan (used until backfill is run once)
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
    return res.status(200).json({ days, total, from: fromStr, to: toStr, source: 'scan' });
}
