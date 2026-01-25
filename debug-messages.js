
import { getRedisClient, getCandidates } from './api/utils/storage.js';

async function inspectMessages() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('No Redis client');
        process.exit(1);
    }

    console.log('🔍 Fetching recent candidates...');
    const { candidates } = await getCandidates(5);

    if (candidates.length === 0) {
        console.log('No candidates found.');
        process.exit(0);
    }

    const target = candidates[0]; // Let's check the first one, or search for a specific one if needed
    console.log(`Checking messages for: ${target.nombre} (${target.whatsapp}) - ID: ${target.id}`);

    const key = `messages:${target.id}`;
    const messages = await redis.lrange(key, 0, -1);

    console.log(`📊 Total Messages: ${messages.length}`);
    messages.forEach((m, i) => {
        console.log(`[${i}]`, m);
    });

    process.exit(0);
}

inspectMessages();
