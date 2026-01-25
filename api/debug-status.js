
import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) {
            return res.status(500).json({
                status: 'error',
                message: 'Redis client is null',
                env_check: process.env.REDIS_URL ? 'PRESENT' : 'MISSING'
            });
        }

        // Try a ping
        const ping = await redis.ping();

        // Check a key
        await redis.set('debug_status', 'active');
        const val = await redis.get('debug_status');

        return res.status(200).json({
            status: 'ok',
            redis_ping: ping,
            redis_write_read: val,
            env_url_set: !!process.env.REDIS_URL
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message,
            stack: error.stack
        });
    }
}
