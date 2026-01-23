import { getCandidates } from '../utils/storage.js';

export default async function handler(req, res) {
    const { key } = req.query;
    if (key !== 'oscar_debug_2026') return res.status(401).json({ error: 'Unauthorized' });

    try {
        const { candidates } = await getCandidates(20, 0);
        const debugInfo = candidates.map(c => ({
            id: c.id,
            nombre: c.nombre,
            nombreReal: c.nombreReal,
            genero: c.genero
        }));

        return res.status(200).json({
            count: candidates.length,
            sample: debugInfo
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
