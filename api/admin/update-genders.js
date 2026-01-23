import { getCandidates, updateCandidate } from '../utils/storage.js';
import { detectGender } from '../utils/ai.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Security check - optional but good to have a simple key
    const { key } = req.query;
    if (key !== 'oscar_detect_2026') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('🚀 Triggering Global Gender Update from API...');
        const { candidates } = await getCandidates(2000, 0);

        const results = {
            total: candidates.length,
            updated: 0,
            skipped: 0,
            logs: []
        };

        for (const candidate of candidates) {
            if (candidate.genero && candidate.genero !== 'Desconocido') {
                results.skipped++;
                continue;
            }

            const nameToUse = candidate.nombreReal || candidate.nombre;
            if (!nameToUse || nameToUse === 'Sin nombre') {
                results.skipped++;
                continue;
            }

            const gender = await detectGender(nameToUse);

            if (gender === 'Hombre' || gender === 'Mujer') {
                await updateCandidate(candidate.id, { genero: gender });
                results.updated++;
                results.logs.push(`${nameToUse} -> ${gender}`);
            } else {
                results.skipped++;
                results.logs.push(`${nameToUse} -> ${gender}`); // Will log "Desconocido" or "Error: ..."
            }

            // Limit to 50 updates per request to avoid Vercel timeouts (10s/60s)
            if (results.updated >= 50) {
                results.message = "Partial update complete (limit 50). Run again for more.";
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
