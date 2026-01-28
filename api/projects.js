
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const {
            getProjects,
            saveProject,
            deleteProject,
            addCandidateToProject,
            removeCandidateFromProject,
            getProjectCandidates
        } = await import('./utils/storage.js');

        const { id } = req.query;

        // GET: List or Detail
        if (req.method === 'GET') {
            if (id) {
                const projects = await getProjects();
                const project = projects.find(p => p.id === id);
                if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

                const candidates = await getProjectCandidates(id);
                return res.status(200).json({ success: true, project, candidates });
            } else {
                const projects = await getProjects();
                return res.status(200).json({ success: true, projects });
            }
        }

        // POST: Create or Add Candidate
        if (req.method === 'POST') {
            const { action, name, projectId, candidateId } = req.body;

            if (action === 'create') {
                if (!name) return res.status(400).json({ error: 'Nombre requerido' });
                const newProject = await saveProject({ name });
                return res.status(200).json({ success: true, project: newProject });
            }

            if (action === 'add-candidate') {
                if (!projectId || !candidateId) return res.status(400).json({ error: 'Faltan datos' });
                await addCandidateToProject(projectId, candidateId);
                return res.status(200).json({ success: true });
            }

            if (action === 'add-multiple') {
                const { candidateIds } = req.body;
                if (!projectId || !candidateIds || !Array.isArray(candidateIds)) {
                    return res.status(400).json({ error: 'Faltan datos' });
                }
                for (const candId of candidateIds) {
                    await addCandidateToProject(projectId, candId);
                }
                return res.status(200).json({ success: true });
            }

            return res.status(400).json({ error: 'Acción inválida' });
        }

        // DELETE: Remove Project or Candidate
        if (req.method === 'DELETE') {
            const { action, projectId, candidateId } = req.body;

            // If id is in query, we assume project deletion
            if (id && !action) {
                await deleteProject(id);
                return res.status(200).json({ success: true });
            }

            if (action === 'remove-candidate') {
                if (!projectId || !candidateId) return res.status(400).json({ error: 'Faltan datos' });
                await removeCandidateFromProject(projectId, candidateId);
                return res.status(200).json({ success: true });
            }

            return res.status(400).json({ error: 'Acción inválida' });
        }

        return res.status(405).json({ error: 'Método no permitido' });

    } catch (error) {
        console.error('❌ Project API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
