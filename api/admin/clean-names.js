/**
 * Batch Name Cleaning Script
 * GET /api/admin/clean-names?key=oscar_debug_2026&limit=100
 */

export default async function handler(req, res) {
    const { key, limit = '15', offset = '0' } = req.query;
    if (key !== 'oscar_debug_2026') return res.status(401).json({ error: 'Unauthorized' });

    const startTime = Date.now();
    const MAX_PROCESS_TIME = 8000; // 8 seconds safety

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');
        const { cleanDateWithAI } = await import('../utils/ai.js');

        const { candidates, total } = await getCandidates(parseInt(limit), parseInt(offset));

        const results = [];
        let updatedCount = 0;
        let processedCount = 0;
        let stoppedEarly = false;

        for (const candidate of candidates) {
            // Safety: Stop if we are approaching Vercel timeout
            if (Date.now() - startTime > MAX_PROCESS_TIME) {
                console.log(`⏳ [Batch Cleaning] Stopping early due to timeout risk after ${processedCount} candidates.`);
                stoppedEarly = true;
                break;
            }

            processedCount++;
            const originalDate = candidate.fechaNacimiento || candidate.fecha;

            // Prepare Updates
            const updates = {};
            let changed = false;

            try {
                // EXCLUSIVE DATE CLEANING
                if (originalDate && originalDate.length > 5 && !/^\d{2}\/\d{2}\/\d{4}$/.test(originalDate)) {
                    console.log(`🤖 [Batch Date] Cleaning: "${originalDate}" for ${candidate.whatsapp}...`);
                    const cleanedDate = await cleanDateWithAI(originalDate);

                    if (cleanedDate && cleanedDate !== 'INVALID' && cleanedDate !== originalDate) {
                        const targetField = candidate.fechaNacimiento ? 'fechaNacimiento' : 'fecha';
                        updates[targetField] = cleanedDate;
                        changed = true;
                    }
                }

                if (changed) {
                    await updateCandidate(candidate.id, updates);
                    updatedCount++;
                    results.push({
                        whatsapp: candidate.whatsapp,
                        date: { before: originalDate, after: updates.fechaNacimiento || updates.fecha }
                    });
                }
            } catch (err) {
                console.error(`Error cleaning date for ${candidate.whatsapp}:`, err.message);
            }
        }

        const nextOffset = parseInt(offset) + processedCount;

        // Preview of what we found in this batch (first 3)
        const preview = candidates.slice(0, 3).map(c => ({
            whatsapp: c.whatsapp,
            has_fecha: !!c.fecha,
            has_fechaNac: !!c.fechaNacimiento,
            val_fecha: c.fecha,
            val_fechaNac: c.fechaNacimiento
        }));

        return res.status(200).json({
            success: true,
            total_db: total,
            processed_now: processedCount,
            updated_now: updatedCount,
            stopped_early: stoppedEarly,
            next_offset: nextOffset < total ? nextOffset : null,
            next_url: nextOffset < total ? `https://${req.headers.host}${req.url.split('?')[0]}?key=${key}&limit=${limit}&offset=${nextOffset}` : 'Completado',
            preview,
            details: results
        });

    } catch (error) {
        console.error('Batch name cleaning error:', error);
        return res.status(500).json({ error: error.message });
    }
}
