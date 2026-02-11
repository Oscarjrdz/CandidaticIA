
import { getRedisClient } from '../utils/storage.js';

/**
 * API to list files in the Media Library.
 * Scans for image:* keys and looks for metadata.
 * Pattern: O(N) scan but cached by the library set for O(logN) performance.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const client = getRedisClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        const libraryKey = 'candidatic:media_library';

        // 1. Get IDs from the sorted set (Ordered by newest first)
        const ids = await client.zrevrange(libraryKey, 0, 99);

        if (!ids || ids.length === 0) {
            // Fallback: If set is empty, scan for legacy image:* keys (Safety Migration)
            // This is O(N) but only happens once until the set is populated.
            const keys = await client.keys('meta:image:*');
            if (keys.length > 0) {
                console.log(`[Library] 🛡️ Migrating ${keys.length} legacy keys to index set...`);
                const pipeline = client.pipeline();
                for (const k of keys) {
                    const id = k.replace('meta:image:', '');
                    pipeline.zadd(libraryKey, Date.now(), id);
                }
                await pipeline.exec();
                // Refresh list
                const refreshedIds = await client.zrevrange(libraryKey, 0, 99);
                return await returnHydratedMedia(client, refreshedIds, res);
            }
            return res.status(200).json({ success: true, files: [] });
        }

        return await returnHydratedMedia(client, ids, res);

    } catch (error) {
        console.error('Library List Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function returnHydratedMedia(client, ids, res) {
    const pipeline = client.pipeline();
    ids.forEach(id => {
        pipeline.get(`meta:image:${id}`);
    });

    const results = await pipeline.exec();
    const files = results.map(([err, res], index) => {
        if (err || !res) return null;
        try {
            const meta = JSON.parse(res);
            return {
                id: ids[index],
                url: `/api/image?id=${ids[index]}`,
                ...meta
            };
        } catch { return null; }
    }).filter(Boolean);

    return res.status(200).json({ success: true, files });
}
