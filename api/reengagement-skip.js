/**
 * POST /api/reengagement-skip
 * Body: { candidateId, skip: true|false }
 * Marca o desmarca a un candidato para omitir el re-engagement.
 */
import { updateCandidate, getCandidateById, validateAdminSession } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Seguridad: exige sesión admin válida
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const { candidateId, skip = true } = req.body || {};
    if (!candidateId) return res.status(400).json({ error: 'Falta candidateId' });

    try {
        const candidate = await getCandidateById(candidateId);
        if (!candidate) return res.status(404).json({ error: 'Candidato no encontrado' });

        await updateCandidate(candidateId, { reengagement_skip: Boolean(skip) });
        return res.status(200).json({ success: true, candidateId, skip: Boolean(skip) });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
