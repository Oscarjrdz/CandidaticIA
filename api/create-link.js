import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { title, description, image, url, userId } = req.body;

        const client = getRedisClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        // Generate Short ID (Random 6 chars)
        const id = Math.random().toString(36).substring(2, 8);
        const key = `share:${id}`;

        const createdAt = new Date().toISOString();

        // Save metadata to Redis (Expire in 90 days)
        const metadata = {
            id, title, description, image, url, createdAt, userId,
            redirectEnabled: req.body.redirectEnabled || false,
            redirectUrl: req.body.redirectUrl || ''
        };
        await client.set(key, JSON.stringify(metadata), 'EX', 90 * 24 * 60 * 60);

        // Add to User's History
        if (userId) {
            const userHistoryKey = `posts:${userId}`;
            // Store just the ID in the list
            await client.lpush(userHistoryKey, id);
        }

        // Construct Short URL
        // In Vercel, req.headers.host works well
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const shortUrl = `${protocol}://${host}/s/${id}`;

        return res.status(200).json({ success: true, shortUrl, id });

    } catch (error) {
        console.error('Link Creation Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
