/**
 * NASCAR Cleanup Endpoint 🏎️🏁
 * POST /api/candidates/cleanup
 * Force AI cleaning for all candidates with missing or dirty data.
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');
        const { cleanNameWithAI, detectGender, cleanMunicipioWithAI, cleanEmploymentStatusWithAI } = await import('../utils/ai.js');

        // 🏎️ Scan the first 500 candidates (Deep clean)
        const { candidates } = await getCandidates(500, 0);

        const dirtyCandidates = candidates.filter(c =>
            !c.genero ||
            (c.nombreReal && c.nombreReal.includes('*')) ||
            !c.municipio ||
            (c.municipio && c.municipio.length < 3)
        );

        console.log(`🏎️ NASCAR Motor: Starting deep clean for ${dirtyCandidates.length} candidates...`);

        const results = [];
        // Process in small batches to avoid hitting Gemini rate limits too hard
        for (const candidate of dirtyCandidates) {
            try {
                const updates = {};

                // 1. Clean Name & Gender
                if (!candidate.genero || (candidate.nombreReal && candidate.nombreReal.includes('*'))) {
                    const targetName = candidate.nombreReal || candidate.nombre || 'Candidato';
                    const cleanedName = await cleanNameWithAI(targetName);
                    updates.nombreReal = cleanedName;

                    const gender = await detectGender(cleanedName);
                    if (gender !== 'Desconocido') updates.genero = gender;
                }

                // 2. Clean Municipality
                if (!candidate.municipio || candidate.municipio.length < 3) {
                    if (candidate.municipio) {
                        const cleanedMuni = await cleanMunicipioWithAI(candidate.municipio);
                        updates.municipio = cleanedMuni;
                    }
                }

                if (Object.keys(updates).length > 0) {
                    await updateCandidate(candidate.id, updates);
                    results.push({ id: candidate.id, status: 'cleaned' });
                }
            } catch (err) {
                console.error(`❌ Cleanup failed for candidate ${candidate.id}:`, err.message);
            }
        }

        return res.status(200).json({
            success: true,
            processed: dirtyCandidates.length,
            cleaned: results.length,
            message: `Motor NASCAR completó la limpieza de ${results.length} perfiles.`
        });

    } catch (error) {
        console.error('❌ NASCAR Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
