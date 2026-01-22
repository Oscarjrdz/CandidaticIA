import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { image, type } = req.body; // Expects base64 string

        if (!image) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        const client = getRedisClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        // Generate ID
        const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const key = `image:${id}`;

        // Store in Redis (Expire in 30 days to keep DB healthy)
        // We store the raw base64 data to keep it simple
        await client.set(key, image, 'EX', 30 * 24 * 60 * 60);

        // Return the public URL (assuming Vercel deployment domain or relative)
        // In local/production, relative path works if on same domain
        const appUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
        const publicUrl = `${appUrl}/api/image?id=${id}`;

        return res.status(200).json({ success: true, url: publicUrl, id });

    } catch (error) {
        console.error('Upload Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
