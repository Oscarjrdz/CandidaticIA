
import { getRedisClient } from './api/utils/storage.js';

async function test() {
    console.log('Testing Redis connection...');
    try {
        const client = getRedisClient();
        if (!client) {
            console.error('Failed to get Redis client');
            return;
        }
        const pong = await client.ping();
        console.log('Redis PONG:', pong);
        process.exit(0);
    } catch (e) {
        console.error('Redis Test Error:', e);
        process.exit(1);
    }
}

test();
