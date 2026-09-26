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
        const { getRedisClient, validateAdminSession, getUsers } = await import('./utils/storage.js');
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        // ── Modo "etiquetas propias" (tags_own_mode) ─────────────────────────────
        // Configurado por el admin en Editar Usuario. Es TRANSPARENTE para el reclutador:
        // sus pantallas simplemente muestran solo las etiquetas que él creó (sin ninguna
        // leyenda de "propias"). SuperAdmin ve/gestiona todas. Las etiquetas legacy (sin
        // dueño) solo las ve el SuperAdmin. El dueño se sella en `createdBy` al crearlas.
        const currentUser = (await getUsers()).find(u => u.id === userId || u.whatsapp === userId) || null;
        const isSuper = currentUser?.role === 'SuperAdmin';
        const tagsOwnMode = !isSuper && !!currentUser?.tags_own_mode;
        const ownsTag = (t) => (typeof t === 'object' && t) ? t.createdBy === currentUser?.id : false;

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

            // 🔎 ETIQUETAS DESCUBIERTAS: etiquetas que EXISTEN en candidatos reales
            // (countsMap) pero que NUNCA se registraron en 'candidatic:chat_tags'
            // (típicamente etiquetas de anuncios/flujos/importaciones). Antes solo se veían
            // en Envíos Masivos (índice facetado). Ahora también se devuelven aquí para que
            // Chat Web las muestre y puedan borrarse DE RAÍZ. Se marcan registered:false para
            // que el frontend NO las persista en el registro curado al guardar (POST).
            const registeredNorm = new Set(tags.map(t => String(t.name || '').trim().toLowerCase()));
            const discovered = Object.entries(countsMap)
                .filter(([name]) => name && !registeredNorm.has(String(name).trim().toLowerCase()))
                .map(([name, count]) => ({ name, color: '#9ca3af', count, registered: false }))
                .sort((a, b) => b.count - a.count);

            // En modo "propias" el reclutador solo ve las etiquetas que él creó (las
            // descubiertas y las legacy no tienen dueño → quedan fuera). Transparente.
            let visibleTags = [...tags, ...discovered];
            if (tagsOwnMode) visibleTags = visibleTags.filter(ownsTag);

            const payload = { success: true, tags: visibleTags, untaggedCount };
            return res.status(200).json(payload);
        }

        // ── POST — save tag list (merge que preserva la propiedad) ──────────────
        if (req.method === 'POST') {
            const { tags: incoming } = req.body;
            if (!Array.isArray(incoming)) return res.status(400).json({ error: 'tags debe ser un arreglo' });

            const rawExisting = await redis.get('candidatic:chat_tags');
            const existing = rawExisting ? JSON.parse(rawExisting) : [];
            const existingByName = new Map(
                existing.map(t => {
                    const obj = typeof t === 'string' ? { name: t } : t;
                    return [String(obj.name || '').trim().toLowerCase(), obj];
                })
            );

            // Normaliza el entrante a objetos y SELLA la propiedad: conserva el createdBy
            // que ya tuviera la etiqueta; si es nueva, el dueño es quien la crea.
            const stamped = incoming.map(t => {
                const obj = typeof t === 'string' ? { name: t, color: '#3b82f6' } : { ...t };
                const prev = existingByName.get(String(obj.name || '').trim().toLowerCase());
                if (prev) {
                    // Ya existía: conserva su dueño tal cual (una legacy sin dueño SIGUE sin dueño;
                    // guardar la lista no debe "reclamar" etiquetas ajenas ni legacy).
                    if (prev.createdBy !== undefined) obj.createdBy = prev.createdBy;
                    else delete obj.createdBy;
                } else {
                    obj.createdBy = userId; // etiqueta nueva → su creador
                }
                delete obj.count;        // el conteo nunca se persiste
                delete obj.registered;   // flag de UI, no se persiste
                return obj;
            });

            let newList;
            if (!tagsOwnMode) {
                // Ve/gestiona todas: el entrante ES la lista completa (con dueños preservados).
                newList = stamped;
            } else {
                // Modo propias: el entrante solo trae SUS etiquetas. Conserva intactas las de
                // los demás (y las legacy/descubiertas) para NO borrarlas. Sus propias quedan
                // exactamente como las mandó (permite renombrar/quitar las suyas).
                const keep = existing.filter(t => !ownsTag(typeof t === 'string' ? { name: t } : t));
                const mine = stamped.filter(t => t.createdBy === currentUser?.id);
                newList = [...keep, ...mine];
            }

            await redis.set('candidatic:chat_tags', JSON.stringify(newList));
            return res.status(200).json({ success: true, tags: newList });
        }

        // ── DELETE — remove tag from system ───────────────────────────────────
        if (req.method === 'DELETE') {
            const tagName = req.query.name;
            if (!tagName) return res.status(400).json({ error: 'Falta nombre de etiqueta' });

            const raw = await redis.get('candidatic:chat_tags');
            let savedTags = raw ? JSON.parse(raw) : [];
            // Modo propias: solo puede borrar etiquetas que él creó.
            if (tagsOwnMode) {
                const target = savedTags.find(t => (typeof t === 'string' ? t : t.name) === tagName);
                if (!target || !ownsTag(typeof target === 'string' ? { name: target } : target)) {
                    return res.status(403).json({ error: 'Sin permiso para eliminar esta etiqueta' });
                }
            }
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
                finally {
                    await redis.hdel(TAG_COUNTS_KEY, tagName).catch(() => {});
                    // Invalidar el índice facetado de Envíos Masivos para que la etiqueta
                    // desaparezca de ahí también (se reconstruye en la próxima apertura), en
                    // vez de seguir listada hasta que venza su TTL. Se hace DESPUÉS del
                    // limpiado para que el rebuild ya no encuentre la etiqueta en candidatos.
                    try {
                        const { FACET_META_KEY, FACET_COUNTS_CACHE_KEY } = await import('./utils/facet-index.js');
                        await redis.del(FACET_META_KEY, FACET_COUNTS_CACHE_KEY).catch(() => {});
                    } catch (_) {}
                }
            })();

            return res.status(200).json({ success: true, message: `Etiqueta '${tagName}' eliminada`, tags: newTags });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
