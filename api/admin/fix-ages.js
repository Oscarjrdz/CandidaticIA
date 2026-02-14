import { getRedisClient } from '../utils/storage.js';

/**
 * 🛠️ AGE FIX API (Admin Only) - DIAGNOSTIC MODE
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
        let cursor = '0';
        let totalScanned = 0;
        let totalFixed = 0;
        let candidatesWithDate = 0;
        let details = [];
        let auditSamples = [];

        // Scan for all candidate keys
        do {
            const result = await redis.scan(cursor, 'MATCH', 'candidatic:candidate:*', 'COUNT', 100);

            cursor = result[0];
            const keys = result[1];

            if (keys.length > 0) {
                const values = await redis.mget(keys);
                totalScanned += keys.length;

                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    const data = values[i];

                    if (!data) continue;

                    try {
                        const candidate = JSON.parse(data);

                        // Capture samples for debugging
                        if (auditSamples.length < 5) {
                            auditSamples.push({
                                name: candidate.nombreReal,
                                dob: candidate.fechaNacimiento,
                                currentAge: candidate.edad
                            });
                        }

                        // Flexible Date Regex: DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
                        if (candidate.fechaNacimiento && /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.test(candidate.fechaNacimiento)) {
                            candidatesWithDate++;

                            // Deterministic Math
                            const [_, dStr, mStr, yStr] = candidate.fechaNacimiento.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
                            const d = parseInt(dStr, 10);
                            const m = parseInt(mStr, 10);
                            const y = parseInt(yStr, 10);

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
                                await redis.set(key, JSON.stringify(candidate));
                                details.push(`Fixed: ${candidate.nombreReal || 'Unknown'} (${candidate.fechaNacimiento}) | ${oldAge} -> ${age}`);
                                totalFixed++;
                            }
                        }
                    } catch (innerErr) { }
                }
            }

        } while (cursor !== '0');

        return res.status(200).json({
            success: true,
            stats: {
                totalScanned,
                candidatesWithDate,
                totalFixed
            },
            details,
            auditSamples // Show what data we actually see
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
