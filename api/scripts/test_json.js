import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getRedisClient } from '../utils/storage.js';

async function main() {
    const redis = getRedisClient();
    const val = await redis.get('candidate:cand_1776316048672_r6r6drrgw'); // from the 38 earlier
    console.log(val);
    process.exit(0);
}
main();
