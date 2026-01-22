import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const { id } = req.query;

    if (!id) {
        return res.status(400).send('Missing ID');
    }

    try {
        const client = getRedisClient();
        if (!client) {
            return res.status(500).send('Database Error');
        }

        const key = `image:${id}`;
        const data = await client.get(key);

        if (!data) {
            return res.status(404).send('Image not found or expired');
        }

        // data is base64 string, likely with data:image/jpeg;base64, prefix
        // We need to serve it as binary
        let imageBuffer;
        let contentType = 'image/jpeg'; // Default

        if (data.includes('base64,')) {
            const matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                contentType = matches[1];
                imageBuffer = Buffer.from(matches[2], 'base64');
            } else {
                // Fallback if regex fails but has prefix
                imageBuffer = Buffer.from(data.split('base64,')[1], 'base64');
            }
        } else {
            imageBuffer = Buffer.from(data, 'base64');
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        res.status(200).send(imageBuffer);

    } catch (error) {
        console.error('Image Serve Error:', error);
        res.status(500).send('Server Error');
    }
}
