import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function run() {
    try {
        console.log('--- RECENT MEDIA ACCESS LOGS ---');
        const logsRaw = await redis.lrange('debug:media_access', 0, -1);
        if (logsRaw.length === 0) {
            console.log('No media access logs found.');
        } else {
            const logs = logsRaw.map(l => JSON.parse(l));
            console.table(logs);
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();
