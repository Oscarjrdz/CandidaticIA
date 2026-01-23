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

            // Skip if no name to clean
            if (!originalName || originalName === 'Sin nombre') continue;

            try {
                // 1. Clean Name with AI
                const cleanedName = await cleanNameWithAI(originalName);

                // 2. Prepare Updates
                const updates = {};
                let changed = false;

                if (cleanedName !== originalName) {
                    updates.nombreReal = cleanedName;
                    changed = true;
                }

                // 3. Optional: Detect gender if missing or name changed
                if (!candidate.genero || changed) {
                    const gender = await detectGender(cleanedName);
                    if (gender !== 'Desconocido' && gender !== candidate.genero) {
                        updates.genero = gender;
                        changed = true;
                    }
                }

                if (changed) {
                    await updateCandidate(candidate.id, updates);
                    updatedCount++;
                    results.push({
                        whatsapp: candidate.whatsapp,
                        before: originalName,
                        after: cleanedName,
                        gender: updates.genero || candidate.genero
                    });
                }
            } catch (err) {
                console.error(`Error cleaning name for ${candidate.whatsapp}:`, err.message);
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
