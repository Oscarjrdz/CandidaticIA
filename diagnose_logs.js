import { getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    process.env.REDIS_URL = 'redis://default:AejdAEEAAiBtNWFlM2I2ZTRmYTU0NmQ2YTRiYzdkZTllYmI5MWU4ZnAxMA@fair-ladybug-43171.upstash.io:6379';
    const redis = getRedisClient();
    try {
        const lastRunRaw = await redis.get('debug:global:last_run');
        console.log('--- LAST RUN ---');
        console.log(lastRunRaw);

        const keys = await redis.keys('debug:agent:logs:*');
        console.log(`\nFound ${keys.length} log keys.`);

        // Pick the most recent one if possible, or just the last run candidate
        if (lastRunRaw) {
            const lastRun = JSON.parse(lastRunRaw);
            const logs = await redis.lrange(`debug:agent:logs:${lastRun.candidateId}`, 0, 5);
            console.log(`\n--- LOGS FOR ${lastRun.candidateId} ---`);
            logs.forEach((l, i) => {
                const parsed = JSON.parse(l);
                console.log(`[${i}] ${parsed.timestamp} | Intent: ${parsed.intent} | Complete: ${parsed.isNowComplete}`);
                console.log(`    AI Result Media: ${parsed.aiResult?.media_url}`);
                console.log(`    Response Text: ${parsed.aiResult?.response_text?.substring(0, 50)}...`);
            });
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

diagnose();
