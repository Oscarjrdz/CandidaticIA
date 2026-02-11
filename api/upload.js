import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { image, type: requestedType } = req.body; // Expects base64 string

        if (!image) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        const client = getRedisClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        // Basic MIME detection from Data URL or Magic Bytes hint
        let mime = 'image/jpeg';
        let base64Data = image;

        if (image.startsWith('data:')) {
            const parts = image.split(',');
            mime = parts[0].split(':')[1].split(';')[0];
            base64Data = parts[1];
        }

        // Security Check: Max size (Vercel limit is 4.5MB total request)
        if (base64Data.length > 5 * 1024 * 1024) {
            return res.status(413).json({ error: 'Payload too large' });
        }

        // Generate ID (using med_ for generic media to avoid image-only validation)
        const id = `med_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const key = `image:${id}`;
        const metaKey = `meta:image:${id}`;

        // Store in Redis
        const pipeline = client.pipeline();
        pipeline.set(key, base64Data, 'EX', 30 * 24 * 60 * 60);
        pipeline.set(metaKey, JSON.stringify({
            mime,
            size: base64Data.length,
            createdAt: new Date().toISOString()
        }), 'EX', 30 * 24 * 60 * 60);

        // Register in Library Index (O(1) scard)
        pipeline.zadd('candidatic:media_library', Date.now(), id);

        await pipeline.exec();

        // Return relative path
        const publicUrl = `/api/image?id=${id}`;


        return res.status(200).json({ success: true, url: publicUrl, id, mime });

    } catch (error) {
        console.error('Upload Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
