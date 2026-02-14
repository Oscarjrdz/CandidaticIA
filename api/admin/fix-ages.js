import { getRedisClient } from '../utils/storage.js';

/**
 * 🛠️ AGE FIX API (Admin Only) - KEY SCOUT MODE
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const redis = getRedisClient();
    if (!redis) {
        return res.status(500).json({ error: 'Redis client not initialized' });
    }

    try {
        // 🕵️ SCOUT MISSION: Dump the first 50 keys to see what's actually in there
        // Maybe the prefix is wrong or I'm missing something
        const keys = await redis.keys('*');
        const sampleKeys = keys.slice(0, 50);

        // Try to identify candidate keys from the sample
        const candidateKeys = keys.filter(k => k.includes('candidate'));

        let sampleData = [];
        if (candidateKeys.length > 0) {
            const sampleK = candidateKeys.slice(0, 5);
            const values = await redis.mget(sampleK);
            sampleData = values.map((v, i) => ({ key: sampleK[i], value: v ? JSON.parse(v) : null }));
        }

        return res.status(200).json({
            success: true,
            totalKeysInDb: keys.length,
            sampleKeys,
            candidateKeysFound: candidateKeys.length,
            sampleData
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
