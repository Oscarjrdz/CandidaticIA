
const Redis = require('ioredis');
require('dotenv').config({ path: '.env.local' });

const seedUser = async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        console.error('REDIS_URL not found in .env.local');
        process.exit(1);
    }

    const redis = new Redis(redisUrl);

    const user = {
        id: 'user_oscar_rodriguez',
        name: 'Oscar rodriguez',
        whatsapp: '8116038195',
        pin: '1234',
        role: 'SuperAdmin',
        status: 'Active',
        createdAt: new Date().toISOString()
    };

    try {
        await redis.set(`user:${user.id}`, JSON.stringify(user));
        await redis.zadd('users:list', Date.now(), user.id);
    } catch (error) {
        console.error('❌ Error seeding user:', error);
    } finally {
        redis.disconnect();
    }
};

seedUser();
