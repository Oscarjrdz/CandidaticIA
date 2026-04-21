import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        const info = await redis.info('memory');
        const count = await redis.dbsize();
        res.status(200).send(`Keys: ${count}\n\n${info}`);
    } catch (e) {
        res.status(500).send(e.message);
    }
}
