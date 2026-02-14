import dotenv from 'dotenv';
dotenv.config();
import { createClient } from 'redis';

const redis = createClient({
    url: process.env.REDIS_URL
});

redis.on('error', (err) => console.error('Redis Client Error', err));

async function fixAges() {
    await redis.connect();
    console.log('🚀 Starting Data Doctor: Age Correction...');

    let cursor = 0;
    let totalFixed = 0;

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

                    // Only update if differnt or missing
                    if (candidate.edad !== age) {
                        const oldAge = candidate.edad;
                        candidate.edad = age;
                        await redis.set(key, JSON.stringify(candidate));
                        console.log(`✅ Fixed: ${candidate.nombreReal} (${candidate.fechaNacimiento}) | Age: ${oldAge} -> ${age}`);
                        totalFixed++;
                    }
                }
            } catch (e) {
                console.error(`Error processing key ${key}:`, e.message);
            }
        }

    } while (cursor !== 0);

    console.log(`\n🎉 DONE! Fixed ${totalFixed} candidate ages.`);
    process.exit(0);
}

fixAges();
