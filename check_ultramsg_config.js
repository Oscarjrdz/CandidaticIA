import { getRedisClient } from './api/utils/storage.js';

const redis = getRedisClient();

console.log('🔍 Checking UltraMsg Config in Redis...\n');

const instanceId = await redis.get('ultramsg_instance_id');
const token = await redis.get('ultramsg_token');

console.log('Instance ID:', instanceId ? `${instanceId.substring(0, 10)}... (${instanceId.length} chars)` : '❌ NOT FOUND');
console.log('Token:', token ? `${token.substring(0, 10)}... (${token.length} chars)` : '❌ NOT FOUND');

if (!instanceId || !token) {
    console.log('\n⚠️ PROBLEM: UltraMsg credentials are missing in Redis!');
    console.log('This explains why messages are not being sent.');
} else {
    console.log('\n✅ Credentials found. Problem is elsewhere.');
}

process.exit(0);
