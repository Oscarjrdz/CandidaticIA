/**
 * Batch Name Cleaning Script
 * GET /api/admin/clean-names?key=oscar_debug_2026&limit=100
 */

export default async function handler(req, res) {
    const { key, limit = '10', offset = '0' } = req.query;
    if (key !== 'oscar_debug_2026') return res.status(401).json({ error: 'Unauthorized' });

    const startTime = Date.now();
    const VERCEL_TIMEOUT = 12000; // 12 seconds safety margin (Hobby is 10s, Pro is 15s-60s)

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');
        const { cleanNameWithAI, detectGender, cleanEmploymentStatusWithAI, cleanMunicipioWithAI, cleanDateWithAI } = await import('../utils/ai.js');

        const { candidates, total } = await getCandidates(parseInt(limit), parseInt(offset));

        const results = [];
        let updatedCount = 0;
        let processedCount = 0;
        let stoppedEarly = false;

        for (const candidate of candidates) {
            // Safety: Stop if we are approaching Vercel timeout
            if (Date.now() - startTime > VERCEL_TIMEOUT) {
                console.log(`⏳ [Batch Cleaning] Stopping early due to timeout risk after ${processedCount} candidates.`);
                stoppedEarly = true;
                break;
            }

            processedCount++;
            const originalName = candidate.nombreReal;
            const originalMunicipio = candidate.municipio;
            const originalEmpleo = candidate.tieneEmpleo;
            const originalDate = candidate.fechaNacimiento || candidate.fecha;

            // Prepare Updates
            const updates = {};
            let changed = false;

            try {
                // RUN AI TASKS (Sequential to avoid rate limits, but we could parallelize internal tasks per candidate)
                // 1. Clean Name with AI
                if (originalName && originalName !== 'Sin nombre') {
                    const cleanedName = await cleanNameWithAI(originalName);
                    if (cleanedName && cleanedName !== originalName) {
                        updates.nombreReal = cleanedName;
                        changed = true;
                    }
                }

                // 2. Gender
                const nameToScan = updates.nombreReal || originalName;
                if (nameToScan && (!candidate.genero || candidate.genero === 'Desconocido')) {
                    const gender = await detectGender(nameToScan);
                    if (gender !== 'Desconocido') {
                        updates.genero = gender;
                        changed = true;
                    }
                }

                // 3. Municipio
                if (originalMunicipio && originalMunicipio !== 'Desconocido') {
                    const cleanedMunicipio = await cleanMunicipioWithAI(originalMunicipio);
                    if (cleanedMunicipio && cleanedMunicipio !== originalMunicipio) {
                        updates.municipio = cleanedMunicipio;
                        changed = true;
                    }
                }

                // 4. Employment
                if (originalEmpleo && originalEmpleo.length > 3 && originalEmpleo !== 'Sí' && originalEmpleo !== 'No') {
                    const cleanedEmpleo = await cleanEmploymentStatusWithAI(originalEmpleo);
                    if (cleanedEmpleo && cleanedEmpleo !== originalEmpleo) {
                        updates.tieneEmpleo = cleanedEmpleo;
                        changed = true;
                    }
                }

                // 5. Date
                if (originalDate && originalDate.length > 5 && !/^\d{2}\/\d{2}\/\d{4}$/.test(originalDate)) {
                    const cleanedDate = await cleanDateWithAI(originalDate);
                    if (cleanedDate && cleanedDate !== 'INVALID' && cleanedDate !== originalDate) {
                        updates[candidate.fechaNacimiento ? 'fechaNacimiento' : 'fecha'] = cleanedDate;
                        changed = true;
                    }
                }

                if (changed) {
                    await updateCandidate(candidate.id, updates);
                    updatedCount++;
                    results.push({
                        whatsapp: candidate.whatsapp,
                        changes: updates
                    });
                }
            } catch (err) {
                console.error(`Error cleaning data for ${candidate.whatsapp}:`, err.message);
            }
        }

        const nextOffset = parseInt(offset) + processedCount;

        return res.status(200).json({
            success: true,
            total_db: total,
            processed_now: processedCount,
            updated_now: updatedCount,
            stopped_early: stoppedEarly,
            next_offset: nextOffset < total ? nextOffset : null,
            next_url: nextOffset < total ? `${req.headers.host}${req.url.split('?')[0]}?key=${key}&limit=${limit}&offset=${nextOffset}` : 'Completado',
            details: results
        });

    } catch (error) {
        console.error('Batch name cleaning error:', error);
        return res.status(500).json({ error: error.message });
    }
}
