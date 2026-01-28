
import { saveProject, getProjects, getProjectById, deleteProject, addCandidateToProject, removeCandidateFromProject, getProjectCandidates } from './utils/storage.js';

export default async function handler(req, res) {
    const { method } = req;
    const { id, candidateId } = req.query;

    try {
        // GET: Fetch projects or candidates of a project
        if (method === 'GET') {
            if (id && req.query.view === 'candidates') {
                const candidates = await getProjectCandidates(id);
                return res.status(200).json({ success: true, candidates });
            }
            if (id) {
                const project = await getProjectById(id);
                return res.status(200).json({ success: true, project });
            }
            const projects = await getProjects();
            return res.status(200).json({ success: true, projects });
        }

        // POST: Create/Update Project OR Link Candidate
        if (method === 'POST') {
            const { action, name, description, projectId, candidateId: bodyCandId } = req.body;

            if (action === 'link') {
                const pid = projectId || id;
                const cid = bodyCandId || candidateId;
                if (!pid || !cid) return res.status(400).json({ success: false, error: 'Project ID and Candidate ID required' });
                await addCandidateToProject(pid, cid);
                return res.status(200).json({ success: true, message: 'Candidate linked to project' });
            }

            if (!name) return res.status(400).json({ success: false, error: 'Project name is required' });
            const project = await saveProject({ id, name, description, assignedUsers });
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
