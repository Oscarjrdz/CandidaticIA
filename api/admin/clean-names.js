/**
 * Batch Name Cleaning Script
 * GET /api/admin/clean-names?key=oscar_debug_2026&limit=100
 */

export default async function handler(req, res) {
    const { key, limit = '100', offset = '0' } = req.query;
    if (key !== 'oscar_debug_2026') return res.status(401).json({ error: 'Unauthorized' });

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');
        const { cleanNameWithAI, detectGender } = await import('../utils/ai.js');

        const { candidates } = await getCandidates(parseInt(limit), parseInt(offset));

        const results = [];
        let updatedCount = 0;

        for (const candidate of candidates) {
            const originalName = candidate.nombreReal;
            const originalMunicipio = candidate.municipio;

            // Prepare Updates
            const updates = {};
            let changed = false;

            try {
                // 1. Clean Name with AI
                if (originalName && originalName !== 'Sin nombre') {
                    const cleanedName = await cleanNameWithAI(originalName);
                    if (cleanedName !== originalName) {
                        updates.nombreReal = cleanedName;
                        changed = true;
                    }

                    // 2. Gender detection if name changed or missing
                    if (!candidate.genero || (updates.nombreReal && updates.nombreReal !== originalName)) {
                        const gender = await detectGender(updates.nombreReal || originalName);
                        if (gender !== 'Desconocido' && gender !== candidate.genero) {
                            updates.genero = gender;
                            changed = true;
                        }
                    }
                }

                // 3. Clean Municipio with AI
                if (originalMunicipio && originalMunicipio !== 'Desconocido') {
                    const { cleanMunicipioWithAI } = await import('../utils/ai.js');
                    const cleanedMunicipio = await cleanMunicipioWithAI(originalMunicipio);
                    if (cleanedMunicipio !== originalMunicipio) {
                        updates.municipio = cleanedMunicipio;
                        changed = true;
                    }
                }

                if (changed) {
                    await updateCandidate(candidate.id, updates);
                    updatedCount++;
                    results.push({
                        whatsapp: candidate.whatsapp,
                        name: { before: originalName, after: updates.nombreReal || originalName },
                        municipio: { before: originalMunicipio, after: updates.municipio || originalMunicipio },
                        gender: updates.genero || candidate.genero
                    });
                }
            } catch (err) {
                console.error(`Error cleaning data for ${candidate.whatsapp}:`, err.message);
            }
        }

        return res.status(200).json({
            success: true,
            total_processed: candidates.length,
            total_updated: updatedCount,
            details: results
        });

    } catch (error) {
        console.error('Batch name cleaning error:', error);
        return res.status(500).json({ error: error.message });
    }
}
