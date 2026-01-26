import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const { id } = req.query;

    if (!id) {
        return res.status(400).send('Missing ID');
    }

    try {
        const client = getRedisClient();
        if (!client) {
            console.error('Redis client not available in /api/image');
            return res.status(500).send('Database Error');
        }

        const key = `image:${id}`;
        const metaKey = `meta:image:${id}`;

        const [data, metaRaw] = await Promise.all([
            client.get(key),
            client.get(metaKey)
        ]);

        if (!data) {
            return res.status(404).send('Not Found');
        }

        const meta = metaRaw ? JSON.parse(metaRaw) : { mime: 'image/jpeg' };

        // Buffer optimization
        const buffer = Buffer.from(data, 'base64');

        // Headers for scale and reliability
        res.setHeader('Content-Type', meta.mime || 'image/jpeg');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year cache
        res.setHeader('Access-Control-Allow-Origin', '*');

        return res.status(200).send(buffer);

    } catch (error) {
        console.error('Error in /api/image:', error);
        return res.status(500).send('Internal Error');
    }
}
