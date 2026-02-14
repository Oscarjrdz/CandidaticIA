import { getRedisClient } from '../utils/storage.js';

/**
 * 🛠️ AGE FIX API (Admin Only)
 * Recalculates candidate ages deterministically based on birthdate.
 * Uses shared ioredis client.
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
        let cursor = '0'; // ioredis uses string cursor
        let totalFixed = 0;
        let details = [];

        // Scan for all candidate keys
        do {
            // ioredis scan syntax: scan(cursor, "MATCH", pattern, "COUNT", count)
            const result = await redis.scan(cursor, 'MATCH', 'candidatic:candidate:*', 'COUNT', 100);

            cursor = result[0];
            const keys = result[1];

            if (keys.length > 0) {
                // Fetch all keys in this batch
                const values = await redis.mget(keys);

                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    const data = values[i];

                    if (!data) continue;

                    try {
                        const candidate = JSON.parse(data);
                        if (candidate.fechaNacimiento && /^\d{2}\/\d{2}\/\d{4}$/.test(candidate.fechaNacimiento)) {

                            // Deterministic Math
                            const [d, m, y] = candidate.fechaNacimiento.split('/').map(Number);
                            const birthDate = new Date(y, m - 1, d);
                            const today = new Date();
                            let age = today.getFullYear() - birthDate.getFullYear();
                            const mo = today.getMonth() - birthDate.getMonth();
                            if (mo < 0 || (mo === 0 && today.getDate() < birthDate.getDate())) {
                                age--;
                            }

                            // Update if different
                            if (candidate.edad !== age) {
                                const oldAge = candidate.edad;
                                candidate.edad = age;
                                // Save back
                                await redis.set(key, JSON.stringify(candidate));
                                details.push(`Fixed: ${candidate.nombreReal || 'Unknown'} | ${oldAge} -> ${age}`);
                                totalFixed++;
                            }
                        }
                    } catch (innerErr) {
                        console.error(`Skipping bad data for key ${key}`);
                    }
                }
            }

        } while (cursor !== '0');

        return res.status(200).json({
            success: true,
            totalFixed,
            message: `Corrected ${totalFixed} candidate ages.`,
            details
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
