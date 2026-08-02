import {
    requireSuperAdmin,
    getSkills,
    upsertSkill,
    deleteSkill
} from '../utils/agent-ia.js';

// ════════════════════════════════════════════════════════════════════════════
// Agent IA — skills de reclutamiento (playbooks por cliente).
//   GET             → { skills: [{id, name, content, updatedAt}] }
//   POST / PUT      → crear/editar: { id?, name, content } → { skill }
//   DELETE ?id=...  → borrar
// Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

const MAX_CONTENT = 60000;

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    try {
        if (req.method === 'GET') {
            return res.status(200).json({ success: true, skills: await getSkills() });
        }

        if (req.method === 'POST' || req.method === 'PUT') {
            const { id, name } = req.body || {};
            const content = String(req.body?.content ?? '').slice(0, MAX_CONTENT);
            const r = await upsertSkill(name, content, id || null);
            if (!r.success) return res.status(400).json(r);
            const skills = await getSkills();
            return res.status(200).json({ success: true, skill: r.skill, created: r.created, skills });
        }

        if (req.method === 'DELETE') {
            const id = req.query?.id;
            if (!id) return res.status(400).json({ success: false, error: 'Falta id' });
            const r = await deleteSkill(id);
            if (!r.success) return res.status(404).json(r);
            const skills = await getSkills();
            return res.status(200).json({ success: true, skills });
        }

        return res.status(405).json({ success: false, error: 'Método no permitido' });
    } catch (error) {
        console.error('❌ [AgentIA] skills error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
