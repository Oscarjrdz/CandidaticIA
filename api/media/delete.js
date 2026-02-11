
import { getRedisClient } from '../utils/storage.js';

/**
 * API to delete assets from the Media Library.
 * Removes both the data (image:*) and metadata (meta:image:*).
 * Also unregisters the ID from the 'candidatic:media_library' set.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { id } = req.body || req.query;

        if (!id) {
            return res.status(400).json({ error: 'Missing asset ID' });
        }

        const client = getRedisClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        const mediaKey = `image:${id}`;
        const metaKey = `meta:image:${id}`;
        const libraryKey = 'candidatic:media_library';

        // Atomic Deletion Pipeline
        const pipeline = client.pipeline();
        pipeline.del(mediaKey);
        pipeline.del(metaKey);
        pipeline.zrem(libraryKey, id);

        const results = await pipeline.exec();
        const errors = results.filter(([err]) => err);

        if (errors.length > 0) {
            console.error('❌ [Library] Deletion partial failure:', errors);
            return res.status(500).json({ success: false, error: 'Partial deletion failure' });
        }

        console.log(`🗑️ [Library] Asset ${id} deleted successfully.`);
        return res.status(200).json({ success: true, message: `Asset ${id} deleted` });

    } catch (error) {
        console.error('Library Deletion Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
