/**
 * Batch Name Cleaning Script
 * GET /api/admin/clean-names?key=oscar_debug_2026&limit=100
 */

export default async function handler(req, res) {
    const { key, limit = '5', offset = '0' } = req.query;
    if (key !== 'oscar_debug_2026') return res.status(401).json({ error: 'Unauthorized' });

    const startTime = Date.now();
    // Vercel Hobby is 10s. We MUST return before that. 
    // Setting safety limit to 7s to allow for overhead and response transmission.
    const MAX_PROCESS_TIME = 7000;

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
            if (Date.now() - startTime > MAX_PROCESS_TIME) {
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
                // RUN AI TASKS IN PARALLEL per candidate to maximize speed
                const tasks = [];

                // 1. Name
                if (originalName && originalName !== 'Sin nombre') {
                    tasks.push(cleanNameWithAI(originalName).then(cleaned => {
                        if (cleaned && cleaned !== originalName) {
                            updates.nombreReal = cleaned;
                            changed = true;
                        }
                    }));
                }

                // 2. Gender (can run in parallel if we use the original name, or sequential if we want cleaned. 
                // Let's use parallel with original to save time; it's usually good enough)
                if (!candidate.genero || candidate.genero === 'Desconocido') {
                    tasks.push(detectGender(originalName || candidate.nombre).then(gender => {
                        if (gender !== 'Desconocido') {
                            updates.genero = gender;
                            changed = true;
                        }
                    }));
                }

                // 3. Municipio
                if (originalMunicipio && originalMunicipio !== 'Desconocido') {
                    tasks.push(cleanMunicipioWithAI(originalMunicipio).then(cleaned => {
                        if (cleaned && cleaned !== originalMunicipio) {
                            updates.municipio = cleaned;
                            changed = true;
                        }
                    }));
                }

                // 4. Employment
                if (originalEmpleo && originalEmpleo.length > 3 && originalEmpleo !== 'Sí' && originalEmpleo !== 'No') {
                    tasks.push(cleanEmploymentStatusWithAI(originalEmpleo).then(cleaned => {
                        if (cleaned && cleaned !== originalEmpleo) {
                            updates.tieneEmpleo = cleaned;
                            changed = true;
                        }
                    }));
                }

                // 5. Date
                if (originalDate && originalDate.length > 5 && !/^\d{2}\/\d{2}\/\d{4}$/.test(originalDate)) {
                    tasks.push(cleanDateWithAI(originalDate).then(cleaned => {
                        if (cleaned && cleaned !== 'INVALID' && cleaned !== originalDate) {
                            updates[candidate.fechaNacimiento ? 'fechaNacimiento' : 'fecha'] = cleaned;
                            changed = true;
                        }
                    }));
                }

                // Await ALL tasks for THIS candidate
                await Promise.allSettled(tasks);

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
            next_url: nextOffset < total ? `https://${req.headers.host}${req.url.split('?')[0]}?key=${key}&limit=${limit}&offset=${nextOffset}` : 'Completado',
            details: results
        });

    } catch (error) {
        console.error('Batch name cleaning error:', error);
        return res.status(500).json({ error: error.message });
    }
}
