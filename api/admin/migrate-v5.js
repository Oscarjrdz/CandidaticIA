import { getCandidates, saveCandidate, getRedisClient } from '../utils/storage.js';

/**
 * Titan Search v5.0 Metadata Repair Script
 * This script iterates through ALL candidates and ensures they have 
 * the 'statusAudit' field injected into their JSON profile.
 */
export default async function handler(req, res) {
    const { secret } = req.query;

    if (secret !== 'oscar-titan-repair-2024') {
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const client = getRedisClient();
        if (!client) throw new Error('Redis not connected');

        console.log('🚀 Starting Titan v5.0 Repair Migration...');

        // 1. Fetch ALL candidates (10,000 limit to be safe)
        const { candidates } = await getCandidates(10000, 0, '', false);
        const total = candidates.length;
        let updatedCount = 0;

        console.log(`📊 Found ${total} candidates. Processing...`);

        // 2. Iterate and Save (this triggers syncCandidateStats internally)
        for (const candidate of candidates) {
            try {
                // saveCandidate calls syncCandidateStats(id, data) 
                // which injects candidate.statusAudit = 'complete'|'pending'
                await saveCandidate(candidate);
                updatedCount++;

                if (updatedCount % 100 === 0) {
                    console.log(`✅ Processed ${updatedCount}/${total}...`);
                }
            } catch (err) {
                console.error(`❌ Failed to update candidate ${candidate.id}:`, err);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Migración Titan v5.0 completada',
            stats: {
                totalAnalizados: total,
                totalActualizados: updatedCount
            }
        });

    } catch (error) {
        console.error('❌ Migration Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
