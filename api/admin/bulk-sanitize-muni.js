import { getRedisClient, updateCandidate } from '../utils/storage.js';

export default async function handler(req, res) {
    // Basic protection
    const token = req.query.token;
    if (token !== 'oscar-muni-2024') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log('🚀 [PROD] Starting bulk municipio sanitization...');
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis client failed' });

    const keys = await redis.keys('candidate:*');
    console.log(`🔍 [PROD] Found ${keys.length} candidates.`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const key of keys) {
        try {
            const dataRaw = await redis.get(key);
            if (!dataRaw) continue;

            const candidate = JSON.parse(dataRaw);
            const candidateId = key.split(':')[1];

            const value = candidate.municipio;
            if (value === undefined || value === null || String(value).trim() === '') {
                await updateCandidate(candidateId, { municipio: 'Monterrey' });
                updatedCount++;
            } else {
                skippedCount++;
            }
        } catch (error) {
            console.error(`❌ [PROD] Error on ${key}:`, error.message);
        }
    }

    return res.status(200).json({
        success: true,
        report: {
            scanned: keys.length,
            updated: updatedCount,
            skipped: skippedCount
        }
    });
}
