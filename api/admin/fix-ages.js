import { getRedisClient } from '../utils/storage.js';

/**
 * 🛠️ AGE FIX API (Admin Only) - ROBUST MODE v2
 * Recalculates candidate ages deterministically based on birthdate.
 * Handles loose date formats.
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
        let ignoredReasons = {};
        let details = [];

        // Scan for all candidate keys
        do {
            const result = await redis.scan(cursor, 'MATCH', 'candidate:cand_*', 'COUNT', 100);

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
                        const dob = candidate.fechaNacimiento;

                        if (!dob) {
                            ignoredReasons['No DOB'] = (ignoredReasons['No DOB'] || 0) + 1;
                            continue;
                        }

                        // Loose Regex: Matches DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY, D-M-YYYY
                        const match = dob.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

                        if (!match) {
                            ignoredReasons['Invalid Check'] = (ignoredReasons['Invalid Check'] || 0) + 1;
                            // Diagnostic log for the first few invalid ones
                            if ((ignoredReasons['Invalid Check'] || 0) < 5) {
                                details.push(`IGNORED (Format): ${candidate.nombreReal} -> ${dob}`);
                            }
                            continue;
                        }

                        // Deterministic Math
                        const [_, dStr, mStr, yStr] = match;
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

                        // Convert both to numbers for comparison
                        const currentAge = parseInt(candidate.edad, 10);

                        // Update if different
                        if (currentAge !== age) {
                            const oldAge = candidate.edad;
                            candidate.edad = age; // Save as number or string? Let's use string to match existing
                            await redis.set(key, JSON.stringify(candidate));
                            details.push(`✅ FIXED: ${candidate.nombreReal || 'Unknown'} (${dob}) | ${oldAge} -> ${age}`);
                            totalFixed++;
                        } else {
                            ignoredReasons['Age Correct'] = (ignoredReasons['Age Correct'] || 0) + 1;
                        }
                    } catch (innerErr) {
                        ignoredReasons['Parse Error'] = (ignoredReasons['Parse Error'] || 0) + 1;
                    }
                }
            }

        } while (cursor !== '0');

        return res.status(200).json({
            success: true,
            stats: {
                totalScanned,
                totalFixed,
                ignoredReasons
            },
            details
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
