import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function dump() {
    const { getRedisClient } = await import('../utils/storage.js');
    const redis = getRedisClient();
    const rawUsers = await redis.get('candidatic_users');
    const users = rawUsers ? JSON.parse(rawUsers) : [];
    users.forEach(u => console.log(u.id, u.name, u.whatsapp));
    process.exit(0);
}
dump();
