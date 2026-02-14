import { getRedisClient } from '../utils/storage.js';

/**
 * 🛠️ AGE FIX API (Admin Only) - TARGET DEBUG MODE
 * - Auto-detects 'Oscar' for deep logging.
 * - Handles Spanish text dates ("19 de mayo de 1983").
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

    // Map Spanish months
    const MONTHS = {
        'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
        'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12,
        'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
        'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12
    };

    try {
        let cursor = '0';
        let totalScanned = 0;
        let totalFixed = 0;
        let ignoredReasons = {};
        let details = [];
        let oscarLogs = [];

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
                        let dob = candidate.fechaNacimiento;
                        const name = candidate.nombreReal || 'Desconocido';

                        // Force debug for likely user
                        const isOscar = name.toLowerCase().includes('oscar');

                        if (!dob) {
                            ignoredReasons['No DOB'] = (ignoredReasons['No DOB'] || 0) + 1;
                            if (isOscar) oscarLogs.push(`[${name}] FAIL: No DOB field present. Age in DB: ${candidate.edad}`);
                            continue;
                        }

                        // Normalize Spanish Date
                        // "19 de mayo de 1983" -> "19/05/1983"
                        let normalizedDob = dob.toLowerCase()
                            .replace(/ de /g, '/')
                            .replace(/ /g, '/')
                            .replace(/-/g, '/'); // 19/mayo/1983

                        // Regex v4: Supports text months
                        const textMatch = normalizedDob.match(/^(\d{1,2})\/([a-z]+)\/(\d{2,4})$/);
                        if (textMatch) {
                            const [_, d, mStr, y] = textMatch;
                            if (MONTHS[mStr]) {
                                normalizedDob = `${d}/${MONTHS[mStr]}/${y}`;
                            }
                        }

                        // Final Standard Check
                        const match = normalizedDob.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);

                        if (!match) {
                            ignoredReasons['Invalid Check'] = (ignoredReasons['Invalid Check'] || 0) + 1;
                            if (isOscar) oscarLogs.push(`[${name}] FAIL: Invalid DOB format: "${dob}" (norm: ${normalizedDob})`);

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

                        // Smart Year
                        if (y < 100) y += (y < 30) ? 2000 : 1900;

                        const birthDate = new Date(y, m - 1, d);
                        const today = new Date();
                        let age = today.getFullYear() - birthDate.getFullYear();
                        const mo = today.getMonth() - birthDate.getMonth();
                        if (mo < 0 || (mo === 0 && today.getDate() < birthDate.getDate())) {
                            age--;
                        }

                        const currentAge = parseInt(candidate.edad, 10);

                        // Update if different
                        if (currentAge !== age) {
                            const oldAge = candidate.edad;
                            candidate.edad = age;
                            // normalize stored date for future consistency
                            candidate.fechaNacimiento = `${d.toString().padStart(2, '0')}/${m.toString().padStart(2, '0')}/${y}`;

                            await redis.set(key, JSON.stringify(candidate));

                            const logMsg = `✅ FIXED: ${name} (${dob}) | ${oldAge} -> ${age}`;
                            details.push(logMsg);
                            if (isOscar) oscarLogs.push(logMsg);
                            totalFixed++;
                        } else {
                            ignoredReasons['Age Correct'] = (ignoredReasons['Age Correct'] || 0) + 1;
                            if (isOscar) oscarLogs.push(`[${name}] PASS: Age ${currentAge} is correct for ${dob} (Calc: ${age})`);
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
            oscarLogs, // Special section for the user
            details
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
