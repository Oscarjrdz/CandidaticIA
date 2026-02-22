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
            if (req.query.action === 'getTemplate') {
                const projects = await getProjects();
                const template = projects.find(p => p.name?.toLowerCase().includes('ayudante aisin'));
                const steps = template?.steps || [];
                return res.status(200).json({ success: true, steps });
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
                query, resultsCount, origin, vacancyId, vacancyIds,
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
                // --- IMMUTABLE STEP VALIDATION ---
                // Ensure 'step_default' is present and first (or at least present)
                const hasDefault = steps.some(s => s.id === 'step_default');
                if (!hasDefault) {
                    return res.status(400).json({ success: false, error: 'Cannot remove the default step (step_default).' });
                }

                const success = await updateProjectSteps(pid, steps);
                return res.status(200).json({ success, message: success ? 'Steps updated' : 'Project not found' });
            }

            if (action === 'reorderProjects') {
                if (!projectIds || !Array.isArray(projectIds)) return res.status(400).json({ success: false, error: 'Project IDs array required' });
                await reorderProjects(projectIds);
                return res.status(200).json({ success: true });
            }

            if (action === 'clone') {
                const pid = bodyProjectId || id;
                if (!pid) return res.status(400).json({ success: false, error: 'Project ID required' });
                const source = await getProjectById(pid);
                if (!source) return res.status(404).json({ success: false, error: 'Proyecto no encontrado' });

                // Clone steps with fresh unique IDs (preserve step_default)
                const clonedSteps = (source.steps || []).map(s => ({
                    ...s,
                    id: s.id === 'step_default' ? 'step_default'
                        : `step_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
                }));

                // Create new project — no vacancies, no bypass
                const cloned = await saveProject({
                    name: `Copia - ${source.name}`,
                    description: source.description || '',
                    assignedUsers: [],
                    vacancyIds: []
                });
                await updateProjectSteps(cloned.id, clonedSteps);
                cloned.steps = clonedSteps;

                return res.status(200).json({ success: true, project: cloned });
            }

            if (!name) return res.status(400).json({ success: false, error: 'Project name is required' });

            // --- IMMUTABLE STEP CREATION ---
            // If creating new project (no ID), allow empty steps but force default
            // If updating, saveProject handles it, but let's ensure structure.

            const { startDate, endDate, templateSteps } = body;
            const existing = id ? await getProjectById(id) : {};

            const incomingVacancyIds = Array.isArray(vacancyIds) ? vacancyIds
                : (vacancyId ? [vacancyId] : (existing.vacancyIds || []));

            // --- VACANCY EXCLUSIVITY: free these vacancies from any other project ---
            if (incomingVacancyIds.length > 0) {
                const allProjects = await getProjects();
                for (const proj of allProjects) {
                    const currentProjId = id || existing.id;
                    if (proj.id === currentProjId) continue;
                    const overlap = (proj.vacancyIds || []).filter(v => incomingVacancyIds.includes(v));
                    if (overlap.length > 0) {
                        proj.vacancyIds = (proj.vacancyIds || []).filter(v => !incomingVacancyIds.includes(v));
                        await saveProject(proj);
                        console.log(`[Projects] Vacancy exclusivity: removed [${overlap}] from project ${proj.id}`);
                    }
                }
            }

            const projectData = {
                ...existing,
                id: id || existing.id,
                name: name || existing.name,
                description: description !== undefined ? description : existing.description,
                assignedUsers: Array.isArray(assignedUsers) ? assignedUsers : existing.assignedUsers || [],
                vacancyIds: incomingVacancyIds,
                startDate: startDate || existing.startDate,
                endDate: endDate !== undefined ? endDate : existing.endDate
            };
            // 🧹 Remove legacy singular vacancyId field if vacancyIds array is present
            if (projectData.vacancyIds && projectData.vacancyIds.length > 0) {
                delete projectData.vacancyId;
            }

            const project = await saveProject(projectData);

            // Post-creation: apply template steps or default
            if (!id && project && (!project.steps || project.steps.length === 0)) {
                // Clone template steps with new unique IDs to avoid collisions
                let stepsToApply;
                if (Array.isArray(templateSteps) && templateSteps.length > 0) {
                    stepsToApply = templateSteps.map(s => ({
                        ...s,
                        id: s.id === 'step_default' ? 'step_default' : `step_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
                    }));
                } else {
                    stepsToApply = [{ id: 'step_default', name: 'Inicio', locked: true }];
                }
                await updateProjectSteps(project.id, stepsToApply);
                project.steps = stepsToApply;
            }

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
