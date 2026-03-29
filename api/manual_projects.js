import { randomUUID } from 'crypto';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();

        if (!redis) {
            if (req.method === 'GET') return res.status(200).json({ success: true, data: [] });
            return res.status(503).json({ error: 'Service Unavailable', message: 'Storage service not available (Redis missing)' });
        }

        const KEY = 'candidatic_manual_projects';

        // GET - List all manual projects
        if (req.method === 'GET') {
            const data = await redis.get(KEY);
            const projects = data ? JSON.parse(data) : [];
            return res.status(200).json({
                success: true,
                data: projects
            });
        }

        // POST - Create a new project
        if (req.method === 'POST') {
            const body = req.body;
            const { name, color } = body;

            if (!name) {
                return res.status(400).json({ error: 'Missing required field: name' });
            }

            const newProject = {
                id: randomUUID(),
                name,
                color: color || '#3b82f6',
                steps: [], // { id, name }
                createdAt: new Date().toISOString()
            };

            const data = await redis.get(KEY);
            const projects = data ? JSON.parse(data) : [];

            projects.push(newProject);

            await redis.set(KEY, JSON.stringify(projects));

            return res.status(201).json({
                success: true,
                data: newProject
            });
        }

        // PUT - Update a project (including its steps)
        if (req.method === 'PUT') {
            const body = req.body;
            const { id, ...updates } = body;

            if (!id) return res.status(400).json({ error: 'Missing id' });

            const data = await redis.get(KEY);
            let projects = data ? JSON.parse(data) : [];

            const index = projects.findIndex(p => p.id === id);
            if (index === -1) return res.status(404).json({ error: 'Project not found' });

            // Ensure steps always stay an array
            if (updates.steps && !Array.isArray(updates.steps)) {
                return res.status(400).json({ error: 'steps must be an array' });
            }

            projects[index] = { ...projects[index], ...updates };

            await redis.set(KEY, JSON.stringify(projects));

            return res.status(200).json({ success: true, data: projects[index] });
        }

        // DELETE - Delete a project
        if (req.method === 'DELETE') {
            const { id } = req.query;

            if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

            const data = await redis.get(KEY);
            let projects = data ? JSON.parse(data) : [];

            const newProjects = projects.filter(p => p.id !== id);

            await redis.set(KEY, JSON.stringify(newProjects));

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Manual Projects API Error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}
