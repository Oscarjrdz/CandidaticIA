/**
 * Batch Employment Status Cleaning Script
 * GET /api/admin/clean-employment?key=oscar_debug_2026&limit=10&offset=0
 */

export default async function handler(req, res) {
    const { key, limit = '10' } = req.query;
    let { offset = '0' } = req.query;
    if (key !== 'oscar_debug_2026') return res.status(401).json({ error: 'Unauthorized' });

    const startTime = Date.now();
    const MAX_PROCESS_TIME = 8000; // 8 seconds safety for Vercel Hobby
    const maxUpdates = parseInt(limit);
    let currentOffset = parseInt(offset);

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');
        const { cleanEmploymentStatusWithAI } = await import('../utils/ai.js');

        const results = [];
        let updatedCount = 0;
        let totalScanned = 0;
        let stoppedEarly = false;
        let totalDb = 0;

        // "SCAN & CLEAN" LOOP
        while (updatedCount < maxUpdates) {
            if (Date.now() - startTime > MAX_PROCESS_TIME) {
                stoppedEarly = true;
                break;
            }

            const fetchLimit = 30;
            const { candidates, total } = await getCandidates(fetchLimit, currentOffset);
            totalDb = total;

            if (!candidates || candidates.length === 0) break;

            for (const candidate of candidates) {
                if (Date.now() - startTime > MAX_PROCESS_TIME) {
                    stoppedEarly = true;
                    break;
                }

                currentOffset++;
                totalScanned++;

                const originalStatus = candidate.tieneEmpleo;

                // Check if it NEEDS cleaning (not "Sí" or "No")
                if (originalStatus && originalStatus.length > 0 && originalStatus !== 'Sí' && originalStatus !== 'No') {
                    console.log(`🤖 [Batch Employment] Cleaning: "${originalStatus}" for ${candidate.whatsapp}...`);
                    try {
                        const cleanedStatus = await cleanEmploymentStatusWithAI(originalStatus);

                        if (cleanedStatus && (cleanedStatus === 'Sí' || cleanedStatus === 'No') && cleanedStatus !== originalStatus) {
                            await updateCandidate(candidate.id, { tieneEmpleo: cleanedStatus });
                            updatedCount++;
                            results.push({
                                whatsapp: candidate.whatsapp,
                                before: originalStatus,
                                after: cleanedStatus
                            });

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
            column: 'tieneEmpleo',
            total_in_db: totalDb,
            scanned_now: totalScanned,
            updated_now: updatedCount,
            stopped_because: stoppedEarly ? 'Timeout safety (8s)' : (updatedCount >= maxUpdates ? 'Limit reached' : 'End of DB'),
            next_offset: currentOffset < totalDb ? currentOffset : 'Completado',
            next_url: nextUrl || 'Completado',
            details: results
        });

    } catch (error) {
        console.error('Batch employment cleaning error:', error);
        return res.status(500).json({ error: error.message });
    }
}
