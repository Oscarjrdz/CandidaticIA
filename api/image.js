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

        // Handle both ?id=img_123 and ?id=img_123.ogg (helper for some APIs)
        const parts = id.split('.');
        const rawId = parts[0];
        let requestedExt = parts[1] || req.query.ext;

        // Clean leading dots
        if (requestedExt && requestedExt.startsWith('.')) {
            requestedExt = requestedExt.substring(1);
        }


        const key = `image:${rawId}`;
        const metaKey = `meta:image:${rawId}`;

        const [data, metaRaw] = await Promise.all([
            client.get(key),
            client.get(metaKey)
        ]);

        if (!data) {
            return res.status(404).send('Not Found');
        }

        const meta = metaRaw ? JSON.parse(metaRaw) : { mime: 'image/jpeg' };

        // Binary conversion
        const buffer = Buffer.from(data, 'base64');

        // TRACKING: Log access to Redis for reachability debugging
        const accessLog = {
            timestamp: new Date().toISOString(),
            id,
            ext: requestedExt,
            ua: req.headers['user-agent'] || 'Unknown',
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
        };
        await client.lpush('debug:media_access', JSON.stringify(accessLog));
        await client.ltrim('debug:media_access', 0, 49); // Keep last 50


        // MIME Spoofing (WhatsApp standard is ogg)
        let finalMime = meta.mime;
        if (requestedExt === 'ogg' || (meta.mime && meta.mime.includes('audio'))) {
            finalMime = 'audio/ogg';
        } else if (requestedExt === 'mp3') {
            finalMime = 'audio/mpeg';
        } else if (requestedExt === 'jpg' || requestedExt === 'jpeg') {
            finalMime = 'image/jpeg';
        }

        // Headers for scale and reliability
        res.setHeader('Content-Type', finalMime);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Access-Control-Allow-Origin', '*');

        return res.end(buffer);

    } catch (error) {
        console.error('Error in /api/image:', error);
        return res.status(500).send('Internal Error');
    }
}
