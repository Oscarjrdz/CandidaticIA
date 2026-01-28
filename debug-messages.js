
import { getRedisClient, getCandidates } from './api/utils/storage.js';

async function inspectMessages() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('No Redis client');
        process.exit(1);
    }

    const { candidates } = await getCandidates(5);

    if (candidates.length === 0) {
        process.exit(0);
    }

    const target = candidates[0]; // Let's check the first one, or search for a specific one if needed

    const key = `messages:${target.id}`;
    const messages = await redis.lrange(key, 0, -1);

    messages.forEach((m, i) => {
    });

    process.exit(0);
}

inspectMessages();
