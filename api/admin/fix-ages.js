import { getRedisClient } from '../utils/storage.js';

/**
 * 🛠️ AGE FIX API (Admin Only) - ROBUST MODE v3
 * - Supports 2-digit years (83 -> 1983)
 * - Supports search (?search=Oscar)
 * - Detailed logs for specific targets
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { search } = req.query;
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
        let specificLogs = [];

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
                        const name = candidate.nombreReal || '';

                        // Search Filter Logic
                        const isTarget = search ? name.toLowerCase().includes(search.toLowerCase()) : false;

                        if (!dob) {
                            ignoredReasons['No DOB'] = (ignoredReasons['No DOB'] || 0) + 1;
                            if (isTarget) specificLogs.push(`[${name}] Skipped: No DOB found.`);
                            continue;
                        }

                        // Loose Regex v3: 
                        // Matches: 19/05/1983, 19/5/83, 19-05-83
                        const match = dob.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);

                        if (!match) {
                            ignoredReasons['Invalid Check'] = (ignoredReasons['Invalid Check'] || 0) + 1;
                            if (isTarget) specificLogs.push(`[${name}] Skipped: Invalid Format (${dob})`);
                            // Log strictly invalid ones to global details if few
                            if ((ignoredReasons['Invalid Check'] || 0) < 10) {
                                details.push(`IGNORED (Format): ${name} -> ${dob}`);
                            }
                            continue;
                        }

                        // Deterministic Math
                        let [_, dStr, mStr, yStr] = match;
                        let d = parseInt(dStr, 10);
                        let m = parseInt(mStr, 10);
                        let y = parseInt(yStr, 10);

                        // Handle 2-digit year (83 -> 1983, 05 -> 2005)
                        if (y < 100) {
                            // Pivot year: 30. If < 30 -> 20xx, Else -> 19xx
                            y += (y < 30) ? 2000 : 1900;
                        }

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
                            candidate.edad = age;
                            // Update DOB to standardized format (YYYY is safer but let's keep DD/MM/YYYY)
                            // candidate.fechaNacimiento = `${d.toString().padStart(2,'0')}/${m.toString().padStart(2,'0')}/${y}`;

                            await redis.set(key, JSON.stringify(candidate));

                            const logMsg = `✅ FIXED: ${name} (${dob}) | ${oldAge} -> ${age}`;
                            details.push(logMsg);
                            if (isTarget) specificLogs.push(logMsg);
                            totalFixed++;
                        } else {
                            ignoredReasons['Age Correct'] = (ignoredReasons['Age Correct'] || 0) + 1;
                            if (isTarget) specificLogs.push(`[${name}] Match: DB=${currentAge} Calc=${age} (DOB: ${dob})`);
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
            searchTarget: search || null,
            specificLogs,
            details
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
