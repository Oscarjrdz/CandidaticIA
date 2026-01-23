import { getCandidates, updateCandidate } from '../utils/storage.js';
import { detectGender } from '../utils/ai.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { key, force } = req.query;
    if (key !== 'oscar_detect_2026') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { candidates: allCandidates } = await getCandidates(2000, 0);

        // Filter and sort: process those with names first
        const candidates = allCandidates.filter(c => {
            const name = c.nombreReal || c.nombre;
            return name && name !== 'Sin nombre' && name.trim().length >= 2;
        });

        const results = {
            total_filtered: candidates.length,
            updated: 0,
            skipped: 0,
            logs: []
        };

        for (const candidate of candidates) {
            const nameToUse = candidate.nombreReal || candidate.nombre;

            // Should we skip this one?
            const hasGender = candidate.genero && candidate.genero !== 'Desconocido';

            if (hasGender && force !== 'true') {
                results.skipped++;
                results.logs.push({ name: nameToUse, reason: `Skipped: already has "${candidate.genero}" (use force=true to overwrite)` });
                continue;
            }

            const gender = await detectGender(nameToUse);

            if (gender === 'Hombre' || gender === 'Mujer') {
                await updateCandidate(candidate.id, { genero: gender });
                results.updated++;
                results.logs.push({ name: nameToUse, result: gender });
            } else {
                results.skipped++;
                results.logs.push({ name: nameToUse, reason: `AI returned ${gender}` });
            }

            // Safety limit per batch: 5 candidates (AI takes ~2s each, Vercel timeout is 10s)
            if (results.updated >= 5) {
                results.message = "Lote de 5 completado para evitar timeout. Refresca para seguir.";
                break;
            }
        }

        return res.status(200).json({
            success: true,
            results
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
