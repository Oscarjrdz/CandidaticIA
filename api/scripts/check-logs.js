import { getRedisClient } from '../utils/storage.js';

async function checkLogs() {
    const client = getRedisClient();
    if (!client) {
        console.error('No Redis client');
        process.exit(1);
    }

    console.log('🔍 Searching for UltraMSG debug logs...');
    const keys = await client.keys('debug:ultramsg:*');

    if (keys.length === 0) {
        console.log('❌ No debug logs found in Redis.');
        process.exit(0);
    }

    for (const key of keys) {
        const data = await client.get(key);
        console.log(`\n--- Log for ${key} ---`);
        console.log(data);
    }
    process.exit(0);
}

checkLogs();
