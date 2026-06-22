import { getCandidates, validateAdminSession } from './utils/storage.js';

const TZ = 'America/Monterrey';

function toMtyDate(isoString) {
    // Returns 'YYYY-MM-DD' in Monterrey timezone
    return new Date(isoString).toLocaleDateString('sv-SE', { timeZone: TZ });
}

function todayMty() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

function addDays(ymdStr, n) {
    // Add n days to a YYYY-MM-DD string without timezone issues (use noon UTC)
    const d = new Date(ymdStr + 'T12:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const toStr   = req.query.to   || todayMty();
    const fromStr = req.query.from || addDays(toStr, -6);

    if (fromStr > toStr) {
        return res.status(400).json({ error: 'Fechas inválidas' });
    }

    const { candidates } = await getCandidates(10000);

    // Group candidates by their Monterrey-timezone date — string comparison, no UTC confusion
    const counts = {};
    for (const c of candidates) {
        const raw = c.createdAt || c.primerContacto;
        if (!raw) continue;
        try {
            const key = toMtyDate(raw); // YYYY-MM-DD in Monterrey
            if (key < fromStr || key > toStr) continue;
            counts[key] = (counts[key] || 0) + 1;
        } catch {}
    }

    // Build contiguous day array from fromStr to toStr
    const days = [];
    let cur = fromStr;
    while (cur <= toStr) {
        const d = new Date(cur + 'T12:00:00.000Z');
        const label = d.toLocaleDateString('es-MX', {
            timeZone: TZ,
            weekday: 'short',
            day: 'numeric',
        });
        days.push({ date: cur, label, count: counts[cur] || 0 });
        cur = addDays(cur, 1);
    }

    const total = days.reduce((s, d) => s + d.count, 0);
    return res.status(200).json({ days, total, from: fromStr, to: toStr });
}
