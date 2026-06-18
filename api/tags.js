/**
 * Tags API
 *
 * Tag counts are maintained as a Redis HASH (candidatic:tag_counts) via
 * HINCRBY/HDECRBY in updateCandidate / deleteCandidate — O(1) reads, no full scan.
 * First request seeds the hash once if it's missing (with stampede protection).
 */

const TAG_COUNTS_KEY      = 'candidatic:tag_counts';
const TAG_COUNTS_INIT_LOCK = 'candidatic:tag_counts:init_lock';

async function getCountsMap(redis) {
    const raw = await redis.hgetall(TAG_COUNTS_KEY);
    if (raw && Object.keys(raw).length > 0) {
        const map = {};
        Object.entries(raw).forEach(([k, v]) => {
            const n = parseInt(v);
            if (n > 0) map[k] = n;
        });
        return map;
    }

    // Hash not seeded yet — one-time full scan with stampede protection
    const locked = await redis.set(TAG_COUNTS_INIT_LOCK, '1', 'EX', 120, 'NX');
    if (!locked) return {}; // another request is seeding — return empty temporarily

    try {
        const { getCandidates } = await import('./utils/storage.js');
        const { candidates } = await getCandidates(20000, 0, '');
        if (candidates.length > 0) {
            const pipeline = redis.pipeline();
            candidates.forEach(c => {
                if (Array.isArray(c.tags)) {
                    c.tags.forEach(t => pipeline.hincrby(TAG_COUNTS_KEY, t, 1));
                }
            });
            await pipeline.exec();
        }
        const seeded = await redis.hgetall(TAG_COUNTS_KEY);
        const map = {};
        Object.entries(seeded || {}).forEach(([k, v]) => {
            const n = parseInt(v);
            if (n > 0) map[k] = n;
        });
        return map;
    } finally {
        await redis.del(TAG_COUNTS_INIT_LOCK);
    }
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

            const countsMap = await getCountsMap(redis);
            tags.forEach(t => { t.count = countsMap[t.name] || 0; });

            return res.status(200).json({ success: true, tags });
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
                    const { getCandidates, updateCandidate } = await import('./utils/storage.js');
                    const { candidates } = await getCandidates(20000, 0, '', false, tagName);
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
