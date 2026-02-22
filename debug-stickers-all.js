
import fs from 'fs';
import Redis from 'ioredis';

const test = async () => {
    try {
        const envContent = fs.readFileSync('.env.prod.local', 'utf8');
        const redisUrlMatch = envContent.match(/REDIS_URL="?([^"\n]+)/);
        if (!redisUrlMatch) {
            console.error("No REDIS_URL found");
            process.exit(1);
        }
        const redisUrl = redisUrlMatch[1];
        const client = new Redis(redisUrl, { tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined });

        const moveSticker = await client.get('bot_step_move_sticker');
        const celebSticker = await client.get('bot_celebration_sticker');
        const allKeys = await client.keys('*sticker*');

        console.log('MOVE STICKER:', moveSticker);
        console.log('CELEB STICKER:', celebSticker);
        console.log('ALL STICKER KEYS:', allKeys);

        for (const key of allKeys) {
            const val = await client.get(key);
            console.log(`${key}: ${val}`);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};
test();
