import { randomUUID } from 'crypto';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { getRedisClient, getCandidateById } = await import('./utils/storage.js');
        const redis = getRedisClient();

        if (!redis) {
            if (req.method === 'GET') return res.status(200).json({ success: true, data: [] });
            return res.status(503).json({ error: 'Service Unavailable', message: 'Storage service not available (Redis missing)' });
        }

        const KEY = 'candidatic_manual_projects';
        const LINKS_PREFIX = 'crm_links:'; // crm_links:{projectId} → [{candidateId, stepId, linkedAt}]

        // GET - List all manual projects OR get candidates for a specific project
        if (req.method === 'GET') {
            const { id, view } = req.query;

            // GET candidates for a specific project
            if (id && view === 'candidates') {
                const linksRaw = await redis.get(`${LINKS_PREFIX}${id}`);
                const links = linksRaw ? JSON.parse(linksRaw) : [];

                if (links.length === 0) {
                    return res.status(200).json({ success: true, candidates: [] });
                }

                // Fetch all linked candidates
                const candidates = [];
                for (const link of links) {
                    try {
                        const cand = await getCandidateById(link.candidateId);
                        if (cand) {
                            candidates.push({
                                ...cand,
                                crmMeta: { stepId: link.stepId, linkedAt: link.linkedAt }
                            });
                        }
                    } catch (e) { /* candidate deleted, skip */ }
                }

                return res.status(200).json({ success: true, candidates });
            }

            // GET all projects
            const data = await redis.get(KEY);
            const projects = data ? JSON.parse(data) : [];
            return res.status(200).json({ success: true, data: projects });
        }

        // POST - Create project OR handle actions
        if (req.method === 'POST') {
            const body = req.body;
            const { action } = body;

            // === ACTION-BASED ROUTING ===
            if (action === 'linkCandidate') {
                const { projectId, candidateId, stepId } = body;
                if (!projectId || !candidateId) return res.status(400).json({ error: 'Missing projectId or candidateId' });

                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];

                // Don't duplicate
                if (links.find(l => l.candidateId === candidateId)) {
                    // Update step if already linked
                    links = links.map(l => l.candidateId === candidateId ? { ...l, stepId: stepId || l.stepId } : l);
                } else {
                    links.push({ candidateId, stepId: stepId || 'step_inicio', linkedAt: new Date().toISOString() });
                }

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(links));
                return res.status(200).json({ success: true });
            }

            if (action === 'batchLink') {
                const { projectId, candidateIds, stepId } = body;
                if (!projectId || !candidateIds?.length) return res.status(400).json({ error: 'Missing data' });

                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];
                const existingIds = new Set(links.map(l => l.candidateId));

                for (const cId of candidateIds) {
                    if (!existingIds.has(cId)) {
                        links.push({ candidateId: cId, stepId: stepId || 'step_inicio', linkedAt: new Date().toISOString() });
                    }
                }

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(links));
                return res.status(200).json({ success: true, linked: candidateIds.length });
            }

            if (action === 'unlinkCandidate') {
                const { projectId, candidateId } = body;
                if (!projectId || !candidateId) return res.status(400).json({ error: 'Missing data' });

                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];
                links = links.filter(l => l.candidateId !== candidateId);

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(links));
                return res.status(200).json({ success: true });
            }

            if (action === 'moveCandidate') {
                const { projectId, candidateId, stepId } = body;
                if (!projectId || !candidateId || !stepId) return res.status(400).json({ error: 'Missing data' });

                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];
                links = links.map(l => l.candidateId === candidateId ? { ...l, stepId } : l);

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(links));
                return res.status(200).json({ success: true });
            }

            if (action === 'updateSteps') {
                const { projectId, steps } = body;
                if (!projectId || !steps) return res.status(400).json({ error: 'Missing data' });

                const data = await redis.get(KEY);
                let projects = data ? JSON.parse(data) : [];
                const idx = projects.findIndex(p => p.id === projectId);
                if (idx === -1) return res.status(404).json({ error: 'Project not found' });

                projects[idx].steps = steps;
                await redis.set(KEY, JSON.stringify(projects));

                return res.status(200).json({ success: true, data: projects[idx] });
            }

            if (action === 'reorderProjects') {
                const { projectIds } = body;
                if (!projectIds) return res.status(400).json({ error: 'Missing projectIds' });

                const data = await redis.get(KEY);
                let projects = data ? JSON.parse(data) : [];
                const reordered = projectIds.map(id => projects.find(p => p.id === id)).filter(Boolean);

                await redis.set(KEY, JSON.stringify(reordered));
                return res.status(200).json({ success: true });
            }

            if (action === 'clone') {
                const { projectId } = body;
                if (!projectId) return res.status(400).json({ error: 'Missing projectId' });

                const data = await redis.get(KEY);
                let projects = data ? JSON.parse(data) : [];
                const original = projects.find(p => p.id === projectId);
                if (!original) return res.status(404).json({ error: 'Project not found' });

                const cloned = {
                    ...JSON.parse(JSON.stringify(original)),
                    id: randomUUID(),
                    name: `${original.name} (copia)`,
                    createdAt: new Date().toISOString(),
                    steps: original.steps.map(s => ({ ...s, id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }))
                };

                projects.unshift(cloned);
                await redis.set(KEY, JSON.stringify(projects));

                return res.status(200).json({ success: true, data: cloned });
            }

            // === DEFAULT: Create new project ===
            const { name, description, color } = body;
            if (!name) return res.status(400).json({ error: 'Missing required field: name' });

            const newProject = {
                id: randomUUID(),
                name,
                description: description || '',
                color: color || '#3b82f6',
                steps: [{ id: 'step_inicio', name: 'Inicio' }],
                createdAt: new Date().toISOString()
            };

            const data = await redis.get(KEY);
            const projects = data ? JSON.parse(data) : [];
            projects.unshift(newProject);
            await redis.set(KEY, JSON.stringify(projects));

            return res.status(201).json({ success: true, data: newProject });
        }

        // PUT - Update a project (name, description, steps)
        if (req.method === 'PUT') {
            const body = req.body;
            const { id, ...updates } = body;

            if (!id) return res.status(400).json({ error: 'Missing id' });

            const data = await redis.get(KEY);
            let projects = data ? JSON.parse(data) : [];

            const index = projects.findIndex(p => p.id === id);
            if (index === -1) return res.status(404).json({ error: 'Project not found' });

            if (updates.steps && !Array.isArray(updates.steps)) {
                return res.status(400).json({ error: 'steps must be an array' });
            }

            projects[index] = { ...projects[index], ...updates };
            await redis.set(KEY, JSON.stringify(projects));

            return res.status(200).json({ success: true, data: projects[index] });
        }

        // DELETE - Delete a project (also clean up links)
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

            const data = await redis.get(KEY);
            let projects = data ? JSON.parse(data) : [];
            const newProjects = projects.filter(p => p.id !== id);
            await redis.set(KEY, JSON.stringify(newProjects));

            // Clean up candidate links
            await redis.del(`${LINKS_PREFIX}${id}`).catch(() => {});

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
