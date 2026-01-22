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

        // Robust Base64 Parsing
        if (data.includes(',')) {
            // Likely "data:image/jpeg;base64,..."
            const parts = data.split(',');
            imageBuffer = Buffer.from(parts[1], 'base64');
        } else {
            // Raw base64
            imageBuffer = Buffer.from(data, 'base64');
        }

        // Just assume JPEG for simplicity/robustness unless we stored type (which we didn't strictly)
        // Browsers are good at sniffing, but consistent header helps.
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Long cache
        res.status(200).send(imageBuffer);

    } catch (error) {
        console.error('Image Serve Error:', error);
        res.status(500).send('Server Error');
    }
}
