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
        const data = await client.get(key);

        if (!data) {
            return res.status(404).send('Image not found');
        }

        let imageBuffer;
        let mimeType = 'image/jpeg';

        // Robust Base64 Parsing with sanitization
        try {
            const cleanData = data.toString().replace(/\s/g, '');

            if (cleanData.includes(',')) {
                // "data:mime/type;base64,..."
                const parts = cleanData.split(',');
                const match = parts[0].match(/data:(.*?);/);
                if (match) mimeType = match[1];
                imageBuffer = Buffer.from(parts[1], 'base64');
            } else {
                // Raw base64
                imageBuffer = Buffer.from(cleanData, 'base64');
            }
        } catch (e) {
            console.error('Base64 Parse Error:', e);
            return res.status(500).send('Media Corrupt');
        }

        res.setHeader('Content-Type', mimeType);
        // Cache long-term as images are immutable by ID
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.status(200).send(imageBuffer);

    } catch (error) {
        console.error('Image Serve Error:', error);
        res.status(500).send('Server Error');
    }
}
