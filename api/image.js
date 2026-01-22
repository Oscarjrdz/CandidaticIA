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

        // Robust Base64 Parsing with sanitization
        try {
            // Remove whitespace/newlines just in case as Redis result might have them (unlikely but safe)
            const cleanData = data.toString().replace(/\s/g, '');

            if (cleanData.includes(',')) {
                // "data:image/jpeg;base64,..."
                const parts = cleanData.split(',');
                imageBuffer = Buffer.from(parts[1], 'base64');
            } else {
                // Raw base64
                imageBuffer = Buffer.from(cleanData, 'base64');
            }
        } catch (e) {
            console.error('Base64 Parse Error:', e);
            return res.status(500).send('Image Corrupt');
        }

        // Assume JPEG because we convert everything to JPEG 0.6/0.7 in frontend
        res.setHeader('Content-Type', 'image/jpeg');
        // Cache long-term as images are immutable by ID
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.status(200).send(imageBuffer);

    } catch (error) {
        console.error('Image Serve Error:', error);
        res.status(500).send('Server Error');
    }
}
