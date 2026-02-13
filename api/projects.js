import {
    saveProject, getProjects, getProjectById, deleteProject,
    addCandidateToProject, removeCandidateFromProject, getProjectCandidates,
    addProjectSearch, getProjectSearches,
    updateProjectSteps, moveCandidateStep, reorderProjects
} from './utils/storage.js';

export default async function handler(req, res) {
    const { method } = req;
    try {
        // Robust body parsing for Vercel
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { id, candidateId } = req.query;
        // GET: Fetch projects or candidates of a project
        if (method === 'GET') {
            if (id && req.query.view === 'candidates') {
                const candidates = await getProjectCandidates(id);
                return res.status(200).json({ success: true, candidates });
            }
            if (id && req.query.view === 'searches') {
                const searches = await getProjectSearches(id);
                return res.status(200).json({ success: true, searches });
            }
            if (id) {
                const project = await getProjectById(id);
                return res.status(200).json({ success: true, project });
            }
            const projects = await getProjects();
            return res.status(200).json({ success: true, projects });
        }

        // POST: Create/Update Project OR Link Candidate OR Save Search
        if (method === 'POST') {
            const {
                action, name, description, projectId: bodyProjectId,
                candidateId: bodyCandId, assignedUsers,
                query, resultsCount, origin, vacancyId,
                stepId, steps, projectIds
            } = body;

            if (action === 'saveSearch') {
                const pid = bodyProjectId || id;
                if (!pid || !query) return res.status(400).json({ success: false, error: 'Project ID and Query required' });
                await addProjectSearch(pid, { query, resultsCount });
                return res.status(200).json({ success: true });
            }

            if (action === 'link') {
                const pid = bodyProjectId || id;
                const cid = bodyCandId || candidateId;
                if (!pid || !cid) return res.status(400).json({ success: false, error: 'Project ID and Candidate ID required' });
                const result = await addCandidateToProject(pid, cid, { origin, stepId });
                return res.status(200).json({ success: true, message: result.migrated ? 'Candidate migrated to this project' : 'Candidate linked to project', migrated: result.migrated });
            }

            if (action === 'moveCandidate') {
                const pid = bodyProjectId || id;
                const cid = bodyCandId || candidateId;
                if (!pid || !cid || !stepId) return res.status(400).json({ success: false, error: 'PID, CID and StepID required' });
                await moveCandidateStep(pid, cid, stepId);
                return res.status(200).json({ success: true });
            }

            if (action === 'batchLink') {
                const pid = bodyProjectId || id;
                const { candidateIds, stepId: targetStepId } = body;
                if (!pid || !candidateIds || !Array.isArray(candidateIds)) {
                    return res.status(400).json({ success: false, error: 'PID and candidateIds array required' });
                }
                const origin = body.origin || 'ai_search';
                let migratedCount = 0;
                for (const cid of candidateIds) {
                    const result = await addCandidateToProject(pid, cid, { origin, stepId: targetStepId });
                    if (result.migrated) migratedCount++;
                }
                return res.status(200).json({ success: true, count: candidateIds.length, migratedCount });
            }

            if (action === 'launchStep') {
                const pid = bodyProjectId || id;
                if (!pid || !stepId) return res.status(400).json({ success: false, error: 'Project ID and Step ID required' });

                const { runAIAutomations } = await import('./utils/automation-engine.js');
                const result = await runAIAutomations(true, { projectId: pid, stepId });

                return res.status(200).json({
                    success: result.success,
                    processed: result.processedCount || 0,
                    error: result.error,
                    logs: result.logs
                });
            }

            if (action === 'updateSteps') {
                const pid = bodyProjectId || id;
                console.log(`[API] Updating steps for project ${pid}:`, steps?.length);
                if (!pid || !steps) {
                    console.error('[API] Missing PID or Steps:', { pid, stepsCount: steps?.length });
                    return res.status(400).json({ success: false, error: 'PID and Steps required' });
                }
                const success = await updateProjectSteps(pid, steps);
                return res.status(200).json({ success, message: success ? 'Steps updated' : 'Project not found' });
            }

            if (action === 'reorderProjects') {
                if (!projectIds || !Array.isArray(projectIds)) return res.status(400).json({ success: false, error: 'Project IDs array required' });
                await reorderProjects(projectIds);
                return res.status(200).json({ success: true });
            }

            if (!name) return res.status(400).json({ success: false, error: 'Project name is required' });
            const project = await saveProject({ id, name, description, assignedUsers, vacancyId });
            return res.status(200).json({ success: true, project });
        }

        // DELETE: Delete project or unlink candidate
        if (method === 'DELETE') {
            if (id && candidateId) {
                await removeCandidateFromProject(id, candidateId);
                return res.status(200).json({ success: true, message: 'Candidate unlinked' });
            }
            if (id) {
                await deleteProject(id);
                return res.status(200).json({ success: true, message: 'Project deleted' });
            }
            return res.status(400).json({ success: false, error: 'ID required' });
        }

        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).end(`Method ${method} Not Allowed`);

    } catch (error) {
        console.error('Projects API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
