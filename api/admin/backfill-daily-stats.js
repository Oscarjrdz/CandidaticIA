import { getCandidates, validateAdminSession, getRedisClient } from '../utils/storage.js';

const TZ = 'America/Monterrey';
const HASH_KEY = 'stats:daily:captures';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Redis no disponible' });

    const { candidates } = await getCandidates(10000);

    const counts = {};
    let skipped = 0;
    for (const c of candidates) {
        const raw = c.createdAt || c.primerContacto;
        if (!raw) { skipped++; continue; }
        try {
            const key = new Date(raw).toLocaleDateString('sv-SE', { timeZone: TZ });
            counts[key] = (counts[key] || 0) + 1;
        } catch { skipped++; }
    }

    // Atomic replace: delete old hash, write new one in pipeline, set initialized marker
    const pipeline = redis.pipeline();
    pipeline.del(HASH_KEY);
    for (const [date, count] of Object.entries(counts)) {
        pipeline.hset(HASH_KEY, date, count);
    }
    pipeline.set('stats:daily:captures:initialized', '1');
    await pipeline.exec();

    return res.status(200).json({
        ok: true,
        totalCandidates: candidates.length,
        daysIndexed: Object.keys(counts).length,
        skipped,
        sample: Object.entries(counts).sort(([a],[b]) => b.localeCompare(a)).slice(0, 5)
    });
}
