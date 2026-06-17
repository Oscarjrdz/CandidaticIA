const TAG_COUNTS_CACHE_KEY = 'candidatic:tag_counts_cache';
const CACHE_TTL = 7200; // 2 horas (era 15 min — el full-scan de 6k candidatos cada 15 min = ~376 MB/día)

export default async function handler(req, res) {
    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();

        if (req.method === 'GET') {
            const raw = await redis.get('candidatic:chat_tags');
            let savedTags = raw ? JSON.parse(raw) : [
                {name: 'Urgente', color: '#64748b'},
                {name: 'Entrevista', color: '#f97316'},
                {name: 'Contratado', color: '#eab308'},
                {name: 'Rechazado', color: '#22c55e'},
                {name: 'Duda', color: '#3b82f6'}
            ];
            const tags = savedTags.map(t => typeof t === 'string' ? {name: t, color: '#3b82f6'} : t);

            // Counts — usar cache de 2 min para evitar escanear 20k candidatos en cada request
            const cachedCounts = await redis.get(TAG_COUNTS_CACHE_KEY);
            let countsMap = {};
            if (cachedCounts) {
                countsMap = JSON.parse(cachedCounts);
            } else {
                const { getCandidates } = await import('./utils/storage.js');
                const { candidates } = await getCandidates(20000, 0, '');
                candidates.forEach(c => {
                    if (Array.isArray(c.tags)) {
                        c.tags.forEach(tName => {
                            countsMap[tName] = (countsMap[tName] || 0) + 1;
                        });
                    }
                });
                await redis.set(TAG_COUNTS_CACHE_KEY, JSON.stringify(countsMap), 'EX', CACHE_TTL);
            }

            tags.forEach(t => { t.count = countsMap[t.name] || 0; });
            return res.status(200).json({ success: true, tags });
        }

        if (req.method === 'POST') {
            const { tags } = req.body;
            await redis.set('candidatic:chat_tags', JSON.stringify(tags));
            await redis.del(TAG_COUNTS_CACHE_KEY); // invalidar cache
            return res.status(200).json({ success: true, tags });
        }

        if (req.method === 'DELETE') {
            const tagName = req.query.name;
            if (!tagName) return res.status(400).json({ error: 'Falta nombre de etiqueta' });

            const raw = await redis.get('candidatic:chat_tags');
            let savedTags = raw ? JSON.parse(raw) : [];
            const newTags = savedTags.filter(t => (typeof t === 'string' ? t : t.name) !== tagName);
            await redis.set('candidatic:chat_tags', JSON.stringify(newTags));
            await redis.del(TAG_COUNTS_CACHE_KEY); // invalidar cache

            // Use tagFilter to scan ONLY candidates that have this tag (avoids loading all 20k)
            const { getCandidates, updateCandidate } = await import('./utils/storage.js');
            const { candidates } = await getCandidates(20000, 0, '', false, tagName);
            const promises = candidates.map(c =>
                updateCandidate(c.id, { tags: c.tags.filter(t => t !== tagName) })
            );
            if (promises.length > 0) await Promise.all(promises);

            return res.status(200).json({ success: true, message: `Etiqueta '${tagName}' eliminada globalmente`, tags: newTags });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
