import dotenv from 'dotenv';
dotenv.config();
import { getRedisClient } from './api/utils/storage.js';

async function main() {
    const redis = getRedisClient();
    const msgs = await redis.lrange('messages:8116038195', -10, -1);
    console.log(msgs);
    process.exit(0);
}
main().catch(console.error);
