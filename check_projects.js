import { getRedisClient } from './api/utils/storage.js';

async function checkProjects() {
    process.env.REDIS_URL = 'redis://default:AejdAEEAAiBtNWFlM2I2ZTRmYTU0NmQ2YTRiYzdkZTllYmI5MWU4ZnAxMA@fair-ladybug-43171.upstash.io:6379';
    const redis = getRedisClient();
    try {
        const keys = await redis.keys('project:*');
        console.log(`Found ${keys.length} projects.\n`);

        for (const key of keys.slice(0, 5)) {
            const data = await redis.get(key);
            if (data) {
                const p = JSON.parse(data);
                console.log(`--- Project: ${p.name} (${p.id}) ---`);
                (p.steps || []).forEach((s, i) => {
                    console.log(`  Step ${i + 1}: ${s.name} | AI: ${s.aiConfig?.enabled ? 'ON' : 'OFF'} | Media: ${s.media_url || 'None'}`);
                });
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkProjects();
