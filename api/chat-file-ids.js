/**
 * API endpoint to get chat file IDs from Redis
 * Used by frontend to sync with cron job uploads
 */

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();

        // Get chat_file_ids from Redis (set by cron job)
        const storedIds = await redis.get('chat_file_ids');
        const fileIds = storedIds ? JSON.parse(storedIds) : {};

        return res.status(200).json({
            success: true,
            fileIds: fileIds
        });
    } catch (error) {
        console.error('Error fetching chat file IDs:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch file IDs',
            fileIds: {}
        });
    }
}
