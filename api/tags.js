/**
 * Tags API
 *
 * Tag counts are maintained as a Redis HASH (candidatic:tag_counts) via
 * HINCRBY/HDECRBY in updateCandidate / deleteCandidate — O(1) reads, no full scan.
 * The incremental counters are the fast path, but they CAN drift (missed adds,
 * double-counted removals under concurrency, or the historical delete-then-decrement
 * bug). So getCountsSummary self-heals with a full recount when it detects the hash
 * is untrustworthy — any negative value, never seeded, or older than the reseed TTL —
 * or when explicitly forced (?reseed=1). A full recount reads every candidate (~1KB
 * each ⇒ ~17MB for 16k), cheap enough to run at most once per RESEED_STALE_MS.
 */

const TAG_COUNTS_KEY      = 'candidatic:tag_counts';
const TAG_COUNTS_INIT_LOCK = 'candidatic:tag_counts:init_lock';
const TAG_COUNTS_SEEDED_AT_KEY = 'candidatic:tag_counts:seeded_at';
const UNTAGGED_COUNT_KEY = 'candidatic:untagged_count';
const UNTAGGED_COUNT_READY_KEY = 'candidatic:untagged_count:ready';
// Reconciliación de seguridad: reseedea a lo más una vez cada 24h (barato: ~17MB).
const RESEED_STALE_MS = 24 * 60 * 60 * 1000;

const cleanTagValues = (tags) => [...new Set((Array.isArray(tags) ? tags : [])
    .map(t => typeof t === 'string' ? t : t?.name)
    .map(t => String(t || '').trim())
    .filter(Boolean))];

// Full recount: rebuilds the tag_counts hash and the untagged counter from the
// authoritative candidate data. Escanea TODO candidates:list (no se apoya en
// scard, que puede subcontar y cortar el barrido antes de tiempo).
async function seedCounts(redis) {
    const tagCounts = {};
    let untaggedCount = 0;
    const CHUNK = 500;

    for (let offset = 0; ; offset += CHUNK) {
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
    writePipe.set(TAG_COUNTS_SEEDED_AT_KEY, String(Date.now()));
    await writePipe.exec();
}

async function getCountsSummary(redis, { force = false } = {}) {
    const ready = (await redis.get(UNTAGGED_COUNT_READY_KEY)) === '1';
    let raw = await redis.hgetall(TAG_COUNTS_KEY);

    // ¿El hash es confiable? Se reseedea si: nunca se construyó, tiene algún valor
    // NEGATIVO (un conteo real jamás puede ser < 0 → corrupción segura), ya venció
    // la ventana de reconciliación, o se forzó (?reseed=1).
    const hasNegative = Object.values(raw || {}).some(v => parseInt(v) < 0);
    const seededAt = parseInt(await redis.get(TAG_COUNTS_SEEDED_AT_KEY)) || 0;
    const stale = !seededAt || (Date.now() - seededAt) > RESEED_STALE_MS;

    if (force || !ready || hasNegative || stale) {
        // Solo un request reseedea a la vez. Si otro tiene el lock, NO devolvemos
        // ceros: seguimos con lo que haya en el hash (piso a 0 abajo).
        const locked = await redis.set(TAG_COUNTS_INIT_LOCK, '1', 'EX', 120, 'NX');
        if (locked) {
            try {
                await seedCounts(redis);
                raw = await redis.hgetall(TAG_COUNTS_KEY);
            } finally { await redis.del(TAG_COUNTS_INIT_LOCK); }
        }
    }

    const map = {};
    Object.entries(raw || {}).forEach(([k, v]) => {
        const n = parseInt(v);
        if (n > 0) map[k] = n; // pisa negativos/ceros: nunca sirve un conteo inválido
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

            // ?reseed=1 fuerza una reconciliación completa bajo demanda.
            const force = req.query.reseed === '1' || req.query.reseed === 'true';
            const { map: countsMap, untaggedCount } = await getCountsSummary(redis, { force });
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
            // Ojo: NO borrar aquí la llave del hash de conteos. El cleanup en background
            // llama updateCandidate por cada candidato, y cada uno hace HDECRBY sobre esa
            // llave; si la borramos antes, esos decrementos la RECREAN en negativo (este
            // fue el origen de METALSA en -2085). El hdel va AL FINAL del cleanup.
            await redis.set('candidatic:chat_tags', JSON.stringify(newTags));

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
                // Ya sin candidatos con la etiqueta, la llave queda en 0 → borrarla limpio.
                finally { await redis.hdel(TAG_COUNTS_KEY, tagName).catch(() => {}); }
            })();

            return res.status(200).json({ success: true, message: `Etiqueta '${tagName}' eliminada`, tags: newTags });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
