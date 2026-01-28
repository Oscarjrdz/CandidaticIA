import { getRedisClient } from '../utils/storage.js';

async function checkLogs() {
    const client = getRedisClient();
    if (!client) {
        console.error('No Redis client');
        process.exit(1);
    }

    const keys = await client.keys('debug:ultramsg:*');

    if (keys.length === 0) {
        process.exit(0);
    }

    for (const key of keys) {
        const data = await client.get(key);
    }
    process.exit(0);
}

checkLogs();
