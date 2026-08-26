/**
 * Tags API
 *
 * Tag counts are maintained as a Redis HASH (candidatic:tag_counts) via
 * HINCRBY/HDECRBY in updateCandidate / deleteCandidate — O(1) reads, no full scan.
 * First request seeds the hash once if it's missing (with stampede protection).
 */

const TAG_COUNTS_KEY      = 'candidatic:tag_counts';
const TAG_COUNTS_INIT_LOCK = 'candidatic:tag_counts:init_lock';
const UNTAGGED_COUNT_KEY = 'candidatic:untagged_count';
const UNTAGGED_COUNT_READY_KEY = 'candidatic:untagged_count:ready';

const cleanTagValues = (tags) => [...new Set((Array.isArray(tags) ? tags : [])
    .map(t => typeof t === 'string' ? t : t?.name)
    .map(t => String(t || '').trim())
    .filter(Boolean))];

// One-time full recount: seeds the tag_counts hash and the untagged counter.
// Normal reads stay O(1); this only runs when the hash has never been built.
async function seedCounts(redis) {
    const total = (await redis.scard('stats:list:complete')) + (await redis.scard('stats:list:pending'));
    const tagCounts = {};
    let untaggedCount = 0;
    const CHUNK = 500;

    for (let offset = 0; offset < total; offset += CHUNK) {
        const ids = await redis.zrevrange('candidates:list', offset, offset + CHUNK - 1);
        if (!ids?.length) break;
        const readPipe = redis.pipeline();
        ids.forEach(id => readPipe.get(`candidate:${id}`));
        const rows = await readPipe.exec();

        for (const [err, rawCandidate] of rows) {
            if (err || !rawCandidate) continue;
            let candidate;
            try { candidate = JSON.parse(rawCandidate); } catch { continue; }
            const tags = cleanTagValues(candidate.tags);
            if (tags.length === 0) {
                untaggedCount++;
                continue;
            }
            tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
        await new Promise(r => setTimeout(r, 2));
    }

    const writePipe = redis.pipeline();
    writePipe.del(TAG_COUNTS_KEY);
    Object.entries(tagCounts).forEach(([tag, count]) => writePipe.hset(TAG_COUNTS_KEY, tag, count));
    writePipe.set(UNTAGGED_COUNT_KEY, String(untaggedCount));
    writePipe.set(UNTAGGED_COUNT_READY_KEY, '1');
    await writePipe.exec();
}

async function getCountsSummary(redis) {
    const ready = (await redis.get(UNTAGGED_COUNT_READY_KEY)) === '1';
    if (!ready) {
        // Become the seeder only if nobody else already is. If another request
        // holds the lock, DON'T return all-zeros — fall through and serve whatever
        // partial data already exists in the hash (avoids the "todo en (0)" flash
        // while the one-time seed scans the whole candidate base).
        const locked = await redis.set(TAG_COUNTS_INIT_LOCK, '1', 'EX', 120, 'NX');
        if (locked) {
            try { await seedCounts(redis); }
            finally { await redis.del(TAG_COUNTS_INIT_LOCK); }
        }
    }

    const raw = await redis.hgetall(TAG_COUNTS_KEY);
    const map = {};
    Object.entries(raw || {}).forEach(([k, v]) => {
        const n = parseInt(v);
        if (n > 0) map[k] = n;
    });
    const untaggedCount = Math.max(0, parseInt(await redis.get(UNTAGGED_COUNT_KEY)) || 0);
    return { map, untaggedCount };
}

export default async function handler(req, res) {
    try {
        const { getRedisClient, validateAdminSession } = await import('./utils/storage.js');
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        // ── GET — list tags with live counts ──────────────────────────────────
        if (req.method === 'GET') {
            const raw = await redis.get('candidatic:chat_tags');
            let savedTags = raw ? JSON.parse(raw) : [
                { name: 'Urgente',    color: '#64748b' },
                { name: 'Entrevista', color: '#f97316' },
                { name: 'Contratado', color: '#eab308' },
                { name: 'Rechazado',  color: '#22c55e' },
                { name: 'Duda',       color: '#3b82f6' },
            ];
            const tags = savedTags.map(t => typeof t === 'string' ? { name: t, color: '#3b82f6' } : t);

            const { map: countsMap, untaggedCount } = await getCountsSummary(redis);
            // Case/whitespace-tolerant fallback: the hash is keyed by the exact tag
            // string stored on each candidate, which can drift in casing/spacing from
            // the saved tag name. Build a normalized index (summing any variants) so a
            // cosmetic mismatch never silently shows (0).
            const normCounts = {};
            Object.entries(countsMap).forEach(([k, v]) => {
                const nk = k.trim().toLowerCase();
                normCounts[nk] = (normCounts[nk] || 0) + v;
            });
            tags.forEach(t => {
                const exact = countsMap[t.name];
                t.count = exact !== undefined ? exact : (normCounts[String(t.name || '').trim().toLowerCase()] || 0);
            });

            const payload = { success: true, tags, untaggedCount };
            return res.status(200).json(payload);
        }

        // ── POST — save tag list ───────────────────────────────────────────────
        if (req.method === 'POST') {
            const { tags } = req.body;
            await redis.set('candidatic:chat_tags', JSON.stringify(tags));
            return res.status(200).json({ success: true, tags });
        }

        // ── DELETE — remove tag from system ───────────────────────────────────
        if (req.method === 'DELETE') {
            const tagName = req.query.name;
            if (!tagName) return res.status(400).json({ error: 'Falta nombre de etiqueta' });

            const raw = await redis.get('candidatic:chat_tags');
            let savedTags = raw ? JSON.parse(raw) : [];
            const newTags = savedTags.filter(t => (typeof t === 'string' ? t : t.name) !== tagName);
            await Promise.all([
                redis.set('candidatic:chat_tags', JSON.stringify(newTags)),
                redis.hdel(TAG_COUNTS_KEY, tagName),
            ]);

            // Background cleanup: remove tag from all candidate profiles (non-blocking)
            (async () => {
                try {
                    const { getCandidatesByTag, updateCandidate } = await import('./utils/storage.js');
                    const candidates = await getCandidatesByTag(tagName, 5000);
                    if (candidates.length > 0) {
                        await Promise.all(candidates.map(c =>
                            updateCandidate(c.id, { tags: c.tags.filter(t => t !== tagName) })
                        ));
                    }
                } catch (_) {}
            })();

            return res.status(200).json({ success: true, message: `Etiqueta '${tagName}' eliminada`, tags: newTags });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
