import { randomUUID } from 'crypto';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { getRedisClient, updateCandidate, validateAdminSession, getCandidates } = await import('./utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });
        const redis = getRedisClient();

        if (!redis) {
            if (req.method === 'GET') return res.status(200).json({ success: true, data: [] });
            return res.status(503).json({ error: 'Service Unavailable', message: 'Storage service not available (Redis missing)' });
        }

        const KEY = 'candidatic_manual_projects';
        const LINKS_PREFIX = 'crm_links:'; // crm_links:{projectId} → [{candidateId, stepId, linkedAt}]
        const publishRealtime = (type, payload = {}) => {
            redis.publish('channel:sse:updates', JSON.stringify({
                type,
                ...payload,
                timestamp: new Date().toISOString()
            })).catch(() => {});
        };

        const loadProjects = async () => {
            const data = await redis.get(KEY);
            return data ? JSON.parse(data) : [];
        };

        const parseLinks = (raw) => {
            if (!raw) return [];
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        };

        const buildProjectCandidatesFromCanonicalRecords = async (projectId, project = null) => {
            const [result, linksRaw] = await Promise.all([
                getCandidates(10000, 0, '', false, '', projectId),
                redis.get(`${LINKS_PREFIX}${projectId}`)
            ]);
            const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
            const links = parseLinks(linksRaw);
            const linkById = new Map(links.map((link, index) => [String(link.candidateId), { ...link, index }]));
            const validStepIds = new Set((project?.steps || []).map(step => String(step.id || '').trim()).filter(Boolean));

            const withCrmMeta = candidates.map(candidate => {
                const link = linkById.get(String(candidate.id));
                let stepId = String(candidate.manualProjectStepId || '').trim();
                if (validStepIds.size > 0 && stepId && !validStepIds.has(stepId)) stepId = '';
                return {
                    ...candidate,
                    crmMeta: {
                        stepId,
                        linkedAt: link?.linkedAt || candidate.manualProjectLinkedAt || candidate.updatedAt || candidate.primerContacto || new Date().toISOString()
                    }
                };
            });

            withCrmMeta.sort((a, b) => {
                const aLink = linkById.get(String(a.id));
                const bLink = linkById.get(String(b.id));
                if (a.crmMeta?.stepId === b.crmMeta?.stepId && aLink && bLink) return aLink.index - bLink.index;
                const aTime = new Date(a.ultimoMensaje || a.primerContacto || a.crmMeta?.linkedAt || 0).getTime();
                const bTime = new Date(b.ultimoMensaje || b.primerContacto || b.crmMeta?.linkedAt || 0).getTime();
                return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
            });

            const repairedLinks = withCrmMeta.map(candidate => ({
                candidateId: candidate.id,
                stepId: candidate.crmMeta.stepId,
                linkedAt: candidate.crmMeta.linkedAt
            })).filter(link => link.stepId);
            const oldSignature = links.map(link => `${link.candidateId}|${link.stepId}`).join(',');
            const newSignature = repairedLinks.map(link => `${link.candidateId}|${link.stepId}`).join(',');
            if (oldSignature !== newSignature) {
                redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(repairedLinks)).catch(() => {});
            }

            return withCrmMeta;
        };

        const unlinkCandidateFromProject = async (projectId, candidateId, { publish = true } = {}) => {
            const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
            const links = linksRaw ? JSON.parse(linksRaw) : [];
            const nextLinks = links.filter(l => l.candidateId !== candidateId);
            if (nextLinks.length === links.length) return false;
            await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(nextLinks));
            if (publish) publishRealtime('crm:candidate', { action: 'unlinkCandidate', projectId, candidateId });
            return true;
        };

        const unlinkCandidateFromOtherProjects = async (candidateId, keepProjectId) => {
            const projects = await loadProjects();
            const removedProjectIds = [];
            for (const project of projects) {
                if (!project?.id || project.id === keepProjectId) continue;
                const removed = await unlinkCandidateFromProject(project.id, candidateId);
                if (removed) removedProjectIds.push(project.id);
            }
            return removedProjectIds;
        };

        const unlinkCandidatesFromRemovedSteps = async (projectId, oldSteps = [], nextSteps = []) => {
            const nextStepIds = new Set((nextSteps || []).map(s => s.id));
            const removedStepIds = (oldSteps || []).map(s => s.id).filter(id => id && !nextStepIds.has(id));
            if (removedStepIds.length === 0) return [];

            const removedSet = new Set(removedStepIds);
            const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
            const links = linksRaw ? JSON.parse(linksRaw) : [];
            const removedLinks = links.filter(l => removedSet.has(l.stepId));
            if (removedLinks.length === 0) return [];

            const keptLinks = links.filter(l => !removedSet.has(l.stepId));
            await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(keptLinks));

            await Promise.all(removedLinks.map(link =>
                updateCandidate(link.candidateId, { manualProjectId: null, manualProjectStepId: null })
                    .catch(() => null)
            ));
            removedLinks.forEach(link => {
                publishRealtime('crm:candidate', {
                    action: 'unlinkCandidate',
                    projectId,
                    candidateId: link.candidateId,
                    reason: 'stepDeleted'
                });
            });
            return removedLinks;
        };

        // GET - List all manual projects OR get candidates for a specific project
        if (req.method === 'GET') {
            const { id, view } = req.query;

            // GET candidates for a specific project
            if (id && view === 'candidates') {
                const projects = await loadProjects();
                const project = projects.find(p => p.id === id) || null;
                const candidates = await buildProjectCandidatesFromCanonicalRecords(id, project);
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

                const removedProjectIds = await unlinkCandidateFromOtherProjects(candidateId, projectId);
                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];
                const existingLink = links.find(l => l.candidateId === candidateId);
                const finalStepId = stepId || existingLink?.stepId || 'step_inicio';

                // Don't duplicate
                if (existingLink) {
                    // Update step if already linked
                    links = links.map(l => l.candidateId === candidateId ? { ...l, stepId: finalStepId } : l);
                } else {
                    links.push({ candidateId, stepId: finalStepId, linkedAt: new Date().toISOString() });
                }

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(links));
                await updateCandidate(candidateId, { manualProjectId: projectId, manualProjectStepId: finalStepId });
                publishRealtime('crm:candidate', { action: 'linkCandidate', projectId, candidateId, stepId: finalStepId, removedProjectIds });
                return res.status(200).json({ success: true });
            }

            if (action === 'batchLink') {
                const { projectId, candidateIds, stepId } = body;
                if (!projectId || !candidateIds?.length) return res.status(400).json({ error: 'Missing data' });

                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];
                const existingIds = new Set(links.map(l => l.candidateId));
                const finalStepId = stepId || 'step_inicio';
                const removedProjectIdsByCandidate = {};

                for (const cId of candidateIds) {
                    const removed = await unlinkCandidateFromOtherProjects(cId, projectId);
                    if (removed.length > 0) removedProjectIdsByCandidate[cId] = removed;
                    if (!existingIds.has(cId)) {
                        links.push({ candidateId: cId, stepId: finalStepId, linkedAt: new Date().toISOString() });
                    }
                }

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(links));
                await Promise.all(candidateIds.map(cId =>
                    updateCandidate(cId, { manualProjectId: projectId, manualProjectStepId: finalStepId })
                ));
                publishRealtime('crm:candidate', { action: 'batchLink', projectId, candidateIds, stepId: finalStepId, removedProjectIdsByCandidate });
                return res.status(200).json({ success: true, linked: candidateIds.length });
            }

            if (action === 'unlinkCandidate') {
                const { projectId, candidateId } = body;
                if (!projectId || !candidateId) return res.status(400).json({ error: 'Missing data' });

                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];
                links = links.filter(l => l.candidateId !== candidateId);

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(links));
                await updateCandidate(candidateId, { manualProjectId: null, manualProjectStepId: null });
                publishRealtime('crm:candidate', { action: 'unlinkCandidate', projectId, candidateId });
                return res.status(200).json({ success: true });
            }

            if (action === 'moveCandidate') {
                const { projectId, candidateId, stepId } = body;
                if (!projectId || !candidateId || !stepId) return res.status(400).json({ error: 'Missing data' });

                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];
                links = links.map(l => l.candidateId === candidateId ? { ...l, stepId } : l);

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify(links));
                await updateCandidate(candidateId, { manualProjectId: projectId, manualProjectStepId: stepId });
                publishRealtime('crm:candidate', { action: 'moveCandidate', projectId, candidateId, stepId });
                return res.status(200).json({ success: true });
            }

            if (action === 'reorderCandidates') {
                const { projectId, stepId, candidateIds } = body;
                if (!projectId || !stepId || !candidateIds?.length) return res.status(400).json({ error: 'Missing data' });

                const linksRaw = await redis.get(`${LINKS_PREFIX}${projectId}`);
                let links = linksRaw ? JSON.parse(linksRaw) : [];

                // Separate links for this step vs other steps
                const otherLinks = links.filter(l => l.stepId !== stepId);
                const stepLinks = links.filter(l => l.stepId === stepId);

                // Reorder step links according to candidateIds order
                const reordered = candidateIds
                    .map(id => stepLinks.find(l => l.candidateId === id))
                    .filter(Boolean);

                // Add any step links that weren't in the candidateIds list (safety net)
                const reorderedIds = new Set(reordered.map(l => l.candidateId));
                const remaining = stepLinks.filter(l => !reorderedIds.has(l.candidateId));

                await redis.set(`${LINKS_PREFIX}${projectId}`, JSON.stringify([...otherLinks, ...reordered, ...remaining]));
                publishRealtime('crm:candidate', { action: 'reorderCandidates', projectId, stepId, candidateIds });
                return res.status(200).json({ success: true });
            }

            if (action === 'updateSteps') {
                const { projectId, steps } = body;
                if (!projectId || !steps) return res.status(400).json({ error: 'Missing data' });

                const data = await redis.get(KEY);
                let projects = data ? JSON.parse(data) : [];
                const idx = projects.findIndex(p => p.id === projectId);
                if (idx === -1) return res.status(404).json({ error: 'Project not found' });

                const oldSteps = projects[idx].steps || [];
                await unlinkCandidatesFromRemovedSteps(projectId, oldSteps, steps);
                projects[idx].steps = steps;
                await redis.set(KEY, JSON.stringify(projects));
                publishRealtime('crm:project', { action: 'stepsUpdated', projectId, project: projects[idx] });

                return res.status(200).json({ success: true, data: projects[idx] });
            }

            if (action === 'reorderProjects') {
                const { projectIds } = body;
                if (!projectIds) return res.status(400).json({ error: 'Missing projectIds' });

                const data = await redis.get(KEY);
                let projects = data ? JSON.parse(data) : [];
                const reordered = projectIds.map(id => projects.find(p => p.id === id)).filter(Boolean);

                await redis.set(KEY, JSON.stringify(reordered));
                publishRealtime('crm:project', { action: 'reordered', projectIds, projects: reordered });
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
                publishRealtime('crm:project', { action: 'cloned', projectId: cloned.id, project: cloned });

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
            publishRealtime('crm:project', { action: 'created', projectId: newProject.id, project: newProject });

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

            if (updates.steps) {
                await unlinkCandidatesFromRemovedSteps(id, projects[index].steps || [], updates.steps);
            }
            projects[index] = { ...projects[index], ...updates };
            await redis.set(KEY, JSON.stringify(projects));
            publishRealtime('crm:project', { action: 'updated', projectId: id, project: projects[index] });

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

            // Clean up candidate links and candidate metadata so other recruiters do not see stale CRM state.
            const linksRaw = await redis.get(`${LINKS_PREFIX}${id}`);
            const links = linksRaw ? JSON.parse(linksRaw) : [];
            await Promise.all(links.map(link =>
                updateCandidate(link.candidateId, { manualProjectId: null, manualProjectStepId: null })
                    .catch(() => null)
            ));
            await redis.del(`${LINKS_PREFIX}${id}`).catch(() => {});
            links.forEach(link => publishRealtime('crm:candidate', {
                action: 'unlinkCandidate',
                projectId: id,
                candidateId: link.candidateId,
                reason: 'projectDeleted'
            }));
            publishRealtime('crm:project', { action: 'deleted', projectId: id });

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
