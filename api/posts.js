import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const client = getRedisClient();
    if (!client) return res.status(500).json({ error: 'Database error' });

    // GET: Fetch Gallery
    if (req.method === 'GET') {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        try {
            // Get list of IDs
            const ids = await client.lrange(`posts:${userId}`, 0, 49); // Recent 50
            if (ids.length === 0) return res.json({ posts: [] });

            // Fetch individual items & click counts
            const pipeline = client.pipeline();
            ids.forEach(id => {
                pipeline.get(`share:${id}`);
                pipeline.get(`clicks:${id}`);
            });
            const results = await pipeline.exec();

            const posts = [];
            for (let i = 0; i < results.length; i += 2) {
                const [errPost, postDataRaw] = results[i];
                const [errClicks, clicksRaw] = results[i + 1];

                if (postDataRaw) {
                    const post = JSON.parse(postDataRaw);
                    post.clicks = parseInt(clicksRaw) || 0;
                    posts.push(post);
                }
            }

            return res.json({ posts });
        } catch (e) {
            return res.status(500).json({ error: 'Error fetching posts' });
        }
    }

    // PUT: Update Post
    if (req.method === 'PUT') {
        const { id, title, description, image, url } = req.body;
        if (!id) return res.status(400).json({ error: 'Missing ID' });

        try {
            const key = `share:${id}`;
            const existingRaw = await client.get(key);

            if (!existingRaw) return res.status(404).json({ error: 'Post not found' });

            const existing = JSON.parse(existingRaw);
            const updated = {
                ...existing,
                title: title || existing.title,
                description: description || existing.description,
                image: image || existing.image,
                url: url || existing.url,
                redirectEnabled: req.body.redirectEnabled !== undefined ? req.body.redirectEnabled : existing.redirectEnabled,
                redirectUrl: req.body.redirectUrl !== undefined ? req.body.redirectUrl : existing.redirectUrl,
                updatedAt: new Date().toISOString()
            };

            // Update in Redis
            await client.set(key, JSON.stringify(updated), 'EX', 90 * 24 * 60 * 60); // Refresh expiry

            return res.json({ success: true, post: updated });
        } catch (e) {
            return res.status(500).json({ error: 'Error updating post' });
        }
    }

    // DELETE: Remove Post
    if (req.method === 'DELETE') {
        const { id, userId } = req.body;
        if (!id || !userId) return res.status(400).json({ error: 'Missing ID or UserId' });

        try {
            const listKey = `posts:${userId}`;
            const metaKey = `share:${id}`;
            const imageKey = `image:${id}`; // We might want to clear the image too if we knew its ID, but usually we just delete the post ref.

            // Remove from User List
            await client.lrem(listKey, 0, id);

            // Delete Metadata
            await client.del(metaKey);

            // Note: We don't delete the image key here because we store the URL, not the image ID directly in the post. 
            // The image will expire automatically in 30 days.

            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: 'Error deleting post' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
