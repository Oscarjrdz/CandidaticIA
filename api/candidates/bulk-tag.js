export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Método no permitido',
            message: 'Solo se aceptan peticiones POST para bulk-tag'
        });
    }

    try {
        const { getCandidateById, updateCandidate } = await import('../utils/storage.js');
        const { ids, tag, action } = req.body;

        if (!Array.isArray(ids)) {
            return res.status(400).json({ success: false, error: 'Lista de IDs no válida' });
        }
        if (!tag) {
            return res.status(400).json({ success: false, error: 'Etiqueta no válida' });
        }

        for (const id of ids) {
            try {
                const cand = await getCandidateById(id);
                if (!cand) continue;
                
                let tags = Array.isArray(cand.tags) ? cand.tags : [];
                
                if (action === 'add' && !tags.includes(tag)) {
                    tags.push(tag);
                    await updateCandidate(id, { tags });
                } else if (action === 'remove' && tags.includes(tag)) {
                    tags = tags.filter(t => t !== tag);
                    await updateCandidate(id, { tags });
                }
            } catch (err) {
                console.error(`Error procesando bulk tag para el candidato ${id}:`, err);
                // Continue with the rest of the candidates even if one fails
            }
        }

        // Trigger stats refresh in background
        import('../utils/bot-stats.js').then(m => m.calculateBotStats()).catch(() => { });

        return res.json({ success: true, count: ids.length, action, tag });
    } catch (e) {
        console.error('Error en bulk-tag handler:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}
