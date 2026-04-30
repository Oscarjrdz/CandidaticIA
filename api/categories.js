/**
 * Categories API - Manage vacancy categories
 * GET /api/categories - List all categories
 * POST /api/categories - Create/Update categories
 * DELETE /api/categories - Delete a category
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();

        if (!redis) {
            if (req.method === 'GET') return res.status(200).json({ success: true, data: [] });
            return res.status(503).json({ error: 'Storage service not available' });
        }

        const KEY = 'candidatic_categories';

        // GET - List categories
        if (req.method === 'GET') {
            const data = await redis.get(KEY);
            const categories = data ? JSON.parse(data) : [];
            return res.status(200).json({
                success: true,
                data: categories
            });
        }

        // POST - Add category
        if (req.method === 'POST') {
            const { name } = req.body;
            if (!name) return res.status(400).json({ error: 'Missing name' });

            const data = await redis.get(KEY);
            let categories = data ? JSON.parse(data) : [];

            // Avoid duplicates
            if (categories.some(c => c.name.toLowerCase() === name.trim().toLowerCase())) {
                return res.status(400).json({ error: 'La categoría ya existe' });
            }

            const newCategory = {
                id: `cat_${Date.now()}`,
                name: name.trim(),
                createdAt: new Date().toISOString()
            };

            categories.unshift(newCategory);
            await redis.set(KEY, JSON.stringify(categories));


            return res.status(201).json({ success: true, data: newCategory });
        }

        // DELETE - Remove category
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Missing id' });

            const data = await redis.get(KEY);
            let categories = data ? JSON.parse(data) : [];

            const newCategories = categories.filter(c => c.id !== id);
            await redis.set(KEY, JSON.stringify(newCategories));


            return res.status(200).json({ success: true });
        }

        // PUT - Edit category name
        if (req.method === 'PUT') {
            const { id, name } = req.body;
            if (!id || !name) return res.status(400).json({ error: 'Missing id or name' });

            const data = await redis.get(KEY);
            let categories = data ? JSON.parse(data) : [];

            const idx = categories.findIndex(c => c.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada' });

            // Avoid duplicates (excluding itself)
            if (categories.some(c => c.id !== id && c.name.toLowerCase() === name.trim().toLowerCase())) {
                return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
            }

            categories[idx].name = name.trim();
            await redis.set(KEY, JSON.stringify(categories));

            return res.status(200).json({ success: true, data: categories[idx] });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Categories API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
