import { getRedisClient } from './api/utils/storage.js';

async function checkVacancies() {
    process.env.REDIS_URL = 'redis://default:AejdAEEAAiBtNWFlM2I2ZTRmYTU0NmQ2YTRiYzdkZTllYmI5MWU4ZnAxMA@fair-ladybug-43171.upstash.io:6379';
    const redis = getRedisClient();
    try {
        const keys = await redis.keys('vacancy:*');
        console.log(`Found ${keys.length} vacancies.\n`);

        for (const key of keys.slice(0, 10)) {
            const data = await redis.get(key);
            if (data) {
                const v = JSON.parse(data);
                console.log(`Vacancy: ${v.name} (${v.id}) | Media: ${v.media_url || 'None'}`);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkVacancies();
