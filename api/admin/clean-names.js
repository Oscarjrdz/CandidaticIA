/**
 * Batch Date Cleaning Script (Optimized)
 * GET /api/admin/clean-names?key=oscar_debug_2026&limit=10&offset=0
 */

export default async function handler(req, res) {
    const { key, limit = '10' } = req.query;
    let { offset = '0' } = req.query;
    if (key !== 'oscar_debug_2026') return res.status(401).json({ error: 'Unauthorized' });

    const startTime = Date.now();
    const MAX_PROCESS_TIME = 8000; // 8 seconds safety for Vercel Hobby (10s limit)
    const maxUpdates = parseInt(limit);
    let currentOffset = parseInt(offset);

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');
        const { cleanDateWithAI } = await import('../utils/ai.js');

        const results = [];
        let updatedCount = 0;
        let totalScanned = 0;
        let stoppedEarly = false;
        let totalDb = 0;

        // "SCAN & CLEAN" LOOP
        // We keep fetching candidates until we reach the update limit OR the timeout
        while (updatedCount < maxUpdates) {
            // Check overall timeout before fetching more
            if (Date.now() - startTime > MAX_PROCESS_TIME) {
                stoppedEarly = true;
                break;
            }

            const fetchLimit = 25; // Fetch in chunks
            const { candidates, total } = await getCandidates(fetchLimit, currentOffset);
            totalDb = total;

            if (!candidates || candidates.length === 0) break;

            for (const candidate of candidates) {
                // Secondary check inside the loop
                if (Date.now() - startTime > MAX_PROCESS_TIME) {
                    stoppedEarly = true;
                    break;
                }

                currentOffset++; // Advance offset for the next run
                totalScanned++;

                const originalDate = candidate.fechaNacimiento || candidate.fecha;

                // Check if it NEEDS cleaning (dirty format)
                if (originalDate && originalDate.length > 5 && !/^\d{2}\/\d{2}\/\d{4}$/.test(originalDate)) {
                    console.log(`🤖 [Batch Date] Cleaning: "${originalDate}" for ${candidate.whatsapp}...`);
                    try {
                        const cleanedDate = await cleanDateWithAI(originalDate);

                        if (cleanedDate && cleanedDate !== 'INVALID' && cleanedDate !== originalDate) {
                            const targetField = candidate.fechaNacimiento ? 'fechaNacimiento' : 'fecha';
                            await updateCandidate(candidate.id, { [targetField]: cleanedDate });
                            updatedCount++;
                            results.push({
                                whatsapp: candidate.whatsapp,
                                before: originalDate,
                                after: cleanedDate
                            });

                            // Stop if we reached the requested limit of UPDATES
                            if (updatedCount >= maxUpdates) break;
                        }
                    } catch (aiErr) {
                        console.error(`AI Error for ${candidate.whatsapp}:`, aiErr.message);
                    }
                }
            }

            if (stoppedEarly || currentOffset >= totalDb || updatedCount >= maxUpdates) break;
        }

        const nextUrl = currentOffset < totalDb
            ? `https://${req.headers.host}${req.url.split('?')[0]}?key=${key}&limit=${limit}&offset=${currentOffset}`
            : null;

        return res.status(200).json({
            success: true,
            total_in_db: totalDb,
            scanned_now: totalScanned,
            updated_now: updatedCount,
            stopped_because: stoppedEarly ? 'Timeout safety (8s)' : (updatedCount >= maxUpdates ? 'Limit reached' : 'End of DB'),
            next_offset: currentOffset < totalDb ? currentOffset : 'Completado',
            next_url: nextUrl || 'Completado',
            details: results
        });

    } catch (error) {
        console.error('Batch date cleaning error:', error);
        return res.status(500).json({ error: error.message });
    }
}
