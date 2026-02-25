import { getRedisClient } from './api/utils/storage.js';

async function findAyudante() {
    process.env.REDIS_URL = 'redis://default:AejdAEEAAiBtNWFlM2I2ZTRmYTU0NmQ2YTRiYzdkZTllYmI5MWU4ZnAxMA@fair-ladybug-43171.upstash.io:6379';
    const redis = getRedisClient();
    try {
        const keys = await redis.keys('vacancy:*');
        for (const key of keys) {
            const data = await redis.get(key);
            if (data && data.includes('AYUDANTE GENERAL')) {
                console.log('--- FOUND VACANCY ---');
                console.log(data);
                return;
            }
        }
        console.log('Vacancy not found in first batch.');
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

findAyudante();
