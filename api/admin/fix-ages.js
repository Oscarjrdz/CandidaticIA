import { createClient } from 'redis';

/**
 * 🛠️ AGE FIX API (Admin Only)
 * Recalculates candidate ages deterministically based on birthdate.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const redis = createClient({
        url: process.env.REDIS_URL
    });

    redis.on('error', (err) => console.error('Redis Client Error', err));

    try {
        await redis.connect();

        let cursor = 0;
        let totalFixed = 0;
        let details = [];

        // Scan for all candidate keys
        do {
            const reply = await redis.scan(cursor, {
                MATCH: 'candidatic:candidate:*',
                COUNT: 100
            });

            cursor = reply.cursor;
            const keys = reply.keys;

            for (const key of keys) {
                try {
                    const data = await redis.get(key);
                    if (!data) continue;

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
                            await redis.set(key, JSON.stringify(candidate));
                            details.push(`Fixed: ${candidate.nombreReal} | ${oldAge} -> ${age}`);
                            totalFixed++;
                        }
                    }
                } catch (e) {
                    console.error(`Error processing key ${key}:`, e.message);
                }
            }

        } while (cursor !== 0);

        await redis.disconnect();

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
