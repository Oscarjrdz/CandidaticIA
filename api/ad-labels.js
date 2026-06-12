/**
 * Ad Labels API — Etiquetas con múltiples adIds por etiqueta.
 *
 * GET    /api/ad-labels
 * POST   /api/ad-labels          → crea etiqueta con uno o varios adIds
 * PUT    /api/ad-labels          → edita etiqueta
 * DELETE /api/ad-labels?id=xxx   → borrado en profundidad
 */

const AD_LABELS_KEY  = 'candidatic:ad_labels';
const GLOBAL_TAGS_KEY = 'candidatic:chat_tags';

/** Normaliza label antiguo (adId string) a adIds array */
const normalize = (l) => ({
    ...l,
    adIds: l.adIds || (l.adId ? [l.adId] : []),
});

/** Parsea input de usuario (string con comas) → array de adIds limpios */
const parseAdIds = (raw = '') =>
    String(raw).split(',').map(s => s.trim()).filter(Boolean);

export default async function handler(req, res) {
    try {
        const { getRedisClient, getCandidates, updateCandidate } = await import('./utils/storage.js');
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

        // ── GET ────────────────────────────────────────────────────────────────
        if (req.method === 'GET') {
            const raw = await redis.get(AD_LABELS_KEY);
            const labels = (raw ? JSON.parse(raw) : []).map(normalize);
            return res.status(200).json({ success: true, labels });
        }

        // ── POST — Crear ───────────────────────────────────────────────────────
        if (req.method === 'POST') {
            const { adIds: rawAdIds, name, emoji, color } = req.body || {};
            const adIds = parseAdIds(rawAdIds);
            if (!adIds.length || !name?.trim()) {
                return res.status(400).json({ error: 'Al menos un Ad ID y nombre son obligatorios' });
            }

            const tagName  = emoji?.trim() ? `${emoji.trim()} ${name.trim()}` : name.trim();
            const tagColor = color || '#a855f7';
            const labelId  = `adlabel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

            const rawLabels = await redis.get(AD_LABELS_KEY);
            const labels = (rawLabels ? JSON.parse(rawLabels) : []).map(normalize);
            if (labels.some(l => l.tagName === tagName && l.adIds.some(id => adIds.includes(id)))) {
                return res.status(400).json({ error: 'Ya existe una etiqueta con ese nombre para alguno de esos Ad IDs' });
            }

            const newLabel = { id: labelId, adIds, tagName, emoji: emoji?.trim() || '', color: tagColor, createdAt: new Date().toISOString() };
            labels.push(newLabel);
            await redis.set(AD_LABELS_KEY, JSON.stringify(labels));

            // Agregar al sistema global de etiquetas
            const rawGlobal = await redis.get(GLOBAL_TAGS_KEY);
            const globalTags = rawGlobal ? JSON.parse(rawGlobal) : [];
            if (!globalTags.some(t => (typeof t === 'string' ? t : t.name) === tagName)) {
                globalTags.push({ name: tagName, color: tagColor });
                await redis.set(GLOBAL_TAGS_KEY, JSON.stringify(globalTags));
            }

            // Batch apply a todos los candidatos con cualquiera de esos adIds
            const { candidates } = await getCandidates(20000, 0, '');
            const updates = [];
            let applied = 0;
            for (const c of candidates) {
                if (!adIds.includes(String(c.adId))) continue;
                const existing = Array.isArray(c.tags) ? c.tags : [];
                if (!existing.includes(tagName)) {
                    updates.push(updateCandidate(c.id, { tags: [...existing, tagName] }));
                    applied++;
                }
            }
            if (updates.length) await Promise.all(updates);
            redis.del('candidatic:tag_counts_cache').catch(() => {});

            return res.status(200).json({ success: true, label: newLabel, applied });
        }

        // ── PUT — Editar ───────────────────────────────────────────────────────
        if (req.method === 'PUT') {
            const { id, adIds: rawAdIds, name, emoji, color } = req.body || {};
            if (!id || !name?.trim()) return res.status(400).json({ error: 'id y nombre son obligatorios' });

            const adIds = parseAdIds(rawAdIds);
            if (!adIds.length) return res.status(400).json({ error: 'Al menos un Ad ID es obligatorio' });

            const rawLabels = await redis.get(AD_LABELS_KEY);
            const labels = (rawLabels ? JSON.parse(rawLabels) : []).map(normalize);
            const idx = labels.findIndex(l => l.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Etiqueta no encontrada' });

            const oldLabel   = labels[idx];
            const oldTagName = oldLabel.tagName;
            const newTagName = emoji?.trim() ? `${emoji.trim()} ${name.trim()}` : name.trim();
            const newColor   = color || oldLabel.color;

            // Nuevos adIds que no estaban antes → aplicar tag a esos candidatos
            const addedAdIds = adIds.filter(id => !oldLabel.adIds.includes(id));

            labels[idx] = { ...oldLabel, adIds, tagName: newTagName, emoji: emoji?.trim() || '', color: newColor };
            await redis.set(AD_LABELS_KEY, JSON.stringify(labels));

            // Actualizar en global tags
            const rawGlobal = await redis.get(GLOBAL_TAGS_KEY);
            const globalTags = rawGlobal ? JSON.parse(rawGlobal) : [];
            const gIdx = globalTags.findIndex(t => (typeof t === 'string' ? t : t.name) === oldTagName);
            if (gIdx !== -1) globalTags[gIdx] = { name: newTagName, color: newColor };
            else globalTags.push({ name: newTagName, color: newColor });
            await redis.set(GLOBAL_TAGS_KEY, JSON.stringify(globalTags));

            // Renombrar en candidatos si cambió el nombre
            let renamed = 0;
            const updates = [];
            const { candidates } = await getCandidates(20000, 0, '');
            for (const c of candidates) {
                const hasTags = Array.isArray(c.tags);
                const hasOldTag = hasTags && c.tags.includes(oldTagName);
                const inNewAdIds = addedAdIds.includes(String(c.adId));
                if (!hasOldTag && !inNewAdIds) continue;

                let newTags = hasTags ? [...c.tags] : [];
                if (hasOldTag && oldTagName !== newTagName) {
                    newTags = newTags.map(t => t === oldTagName ? newTagName : t);
                    renamed++;
                }
                if (inNewAdIds && !newTags.includes(newTagName)) {
                    newTags.push(newTagName);
                    renamed++;
                }
                if (newTags.join(',') !== (c.tags || []).join(',')) {
                    updates.push(updateCandidate(c.id, { tags: newTags }));
                }
            }
            if (updates.length) await Promise.all(updates);
            redis.del('candidatic:tag_counts_cache').catch(() => {});

            return res.status(200).json({ success: true, label: labels[idx], oldTagName, renamed });
        }

        // ── DELETE — Borrado en profundidad ────────────────────────────────────
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Falta id' });

            const rawLabels = await redis.get(AD_LABELS_KEY);
            const labels = (rawLabels ? JSON.parse(rawLabels) : []).map(normalize);
            const idx = labels.findIndex(l => l.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Etiqueta no encontrada' });

            const removed = labels.splice(idx, 1)[0];
            await redis.set(AD_LABELS_KEY, JSON.stringify(labels));

            // Quitar de global tags
            const rawGlobal = await redis.get(GLOBAL_TAGS_KEY);
            const globalTags = rawGlobal ? JSON.parse(rawGlobal) : [];
            await redis.set(GLOBAL_TAGS_KEY, JSON.stringify(
                globalTags.filter(t => (typeof t === 'string' ? t : t.name) !== removed.tagName)
            ));

            // Quitar de todos los candidatos
            const { candidates } = await getCandidates(20000, 0, '');
            const updates = [];
            let removedFrom = 0;
            for (const c of candidates) {
                if (Array.isArray(c.tags) && c.tags.includes(removed.tagName)) {
                    updates.push(updateCandidate(c.id, { tags: c.tags.filter(t => t !== removed.tagName) }));
                    removedFrom++;
                }
            }
            if (updates.length) await Promise.all(updates);
            redis.del('candidatic:tag_counts_cache').catch(() => {});

            return res.status(200).json({ success: true, removed, removedFrom });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        console.error('[ad-labels]', e);
        return res.status(500).json({ error: e.message });
    }
}
