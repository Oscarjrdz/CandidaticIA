import { getCandidates, validateAdminSession } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    // Default: last 7 days (today included)
    const today = new Date();
    const defaultFrom = new Date(today);
    defaultFrom.setDate(today.getDate() - 6);

    const fromStr = req.query.from || defaultFrom.toISOString().slice(0, 10);
    const toStr   = req.query.to   || today.toISOString().slice(0, 10);

    const fromDate = new Date(fromStr + 'T00:00:00.000Z');
    const toDate   = new Date(toStr   + 'T23:59:59.999Z');

    if (isNaN(fromDate) || isNaN(toDate) || fromDate > toDate) {
        return res.status(400).json({ error: 'Fechas inválidas' });
    }

    const candidates = await getCandidates();

    // Count by date (YYYY-MM-DD in America/Monterrey — UTC-6 / UTC-5 DST)
    const counts = {};
    for (const c of candidates) {
        const raw = c.createdAt || c.primerContacto;
        if (!raw) continue;
        const d = new Date(raw);
        if (d < fromDate || d > toDate) continue;
        // Format date in local time (MX)
        const key = d.toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' }); // YYYY-MM-DD
        counts[key] = (counts[key] || 0) + 1;
    }

    // Build a contiguous day-by-day array
    const days = [];
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
        const key = cursor.toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
        const label = cursor.toLocaleDateString('es-MX', {
            timeZone: 'America/Monterrey',
            weekday: 'short',
            day: 'numeric',
        });
        days.push({ date: key, label, count: counts[key] || 0 });
        cursor.setDate(cursor.getDate() + 1);
    }

    const total = days.reduce((s, d) => s + d.count, 0);

    return res.status(200).json({ days, total, from: fromStr, to: toStr });
}
