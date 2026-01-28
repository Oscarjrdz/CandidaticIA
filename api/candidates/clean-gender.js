/**
 * Clean Gender Endpoint ⚧
 * POST /api/candidates/clean-gender
 * Strict normalization for 'genero' column.
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');
        const { detectGender } = await import('../utils/ai.js');

        // Scan ALL candidates (limit 3000 to cover all)
        const { candidates } = await getCandidates(3000, 0);

        const updates = [];
        const log = [];
        let countHombre = 0;
        let countMujer = 0;
        let countNull = 0;


        for (const candidate of candidates) {
            const originalGender = candidate.genero;
            let finalGender = originalGender;

            // 1. Strict Validation
            if (finalGender === 'Hombre' || finalGender === 'Mujer') {
                // Valid, kept it.
                if (finalGender === 'Hombre') countHombre++;
                if (finalGender === 'Mujer') countMujer++;
                continue;
            }

            // 2. If Invalid, Try to Detect
            if (candidate.nombreReal || candidate.nombre) {
                const nameToTest = candidate.nombreReal || candidate.nombre;
                const detected = await detectGender(nameToTest);

                if (detected === 'Hombre' || detected === 'Mujer') {
                    finalGender = detected;
                } else {
                    finalGender = null; // "Desconocido" -> Null
                }
            } else {
                finalGender = null;
            }

            // 3. Apply Update if Changed
            // Note: If original was "Desconocido" and now is null, that's a change.
            // If original was "undefined" and now is null, effectively same for storage but good to standardize?
            // "undefined" in JS usually doesn't exist in JSON from Redis unless parsed.
            // Let's coerce undefined to null for comparison.
            const normOriginal = originalGender || null;

            if (finalGender !== normOriginal) {
                updates.push({ id: candidate.id, genero: finalGender });
                log.push(`${candidate.nombre || 'ID:' + candidate.id}: "${normOriginal}" -> "${finalGender}"`);

                if (finalGender === 'Hombre') countHombre++;
                else if (finalGender === 'Mujer') countMujer++;
                else countNull++;
            } else {
                // Even if no change, count stats
                if (finalGender === 'Hombre') countHombre++;
                else if (finalGender === 'Mujer') countMujer++;
                else countNull++;
            }
        }


        // Batch execution
        const BATCH_SIZE = 50;
        let processed = 0;

        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(u => updateCandidate(u.id, { genero: u.genero })));
            processed += batch.length;
        }

        return res.status(200).json({
            success: true,
            total: candidates.length,
            updated: updates.length,
            stats: {
                Hombre: countHombre,
                Mujer: countMujer,
                SinDatos: countNull
            },
            log: log.slice(0, 100) // First 100 logs
        });

    } catch (error) {
        console.error('❌ Clean Gender Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
