import { getRedisClient, validateAdminSession } from './utils/storage.js';

export default async function handler(req, res) {
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    try {
        const redis = getRedisClient();
        const info = await redis.info('memory');
        const count = await redis.dbsize();
        res.status(200).send(`Keys: ${count}\n\n${info}`);
    } catch (e) {
        res.status(500).send(e.message);
    }
}
