import { requireSuperAdmin, listSkills, loadSkill, hasAnthropicKey, AGENT_MODEL } from '../utils/brenda-agent.js';

// ════════════════════════════════════════════════════════════════════════════
// Lista los skills nativos (carpetas SKILL.md) para la UI de Brenda Agent, y
// permite leer el cuerpo completo de uno (?folder=recruiter-oscar).
// Solo lectura, solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Metodo no permitido' });
    }

    try {
        const folder = req.query?.folder;
        if (folder) {
            const skill = loadSkill(folder);
            if (!skill) return res.status(404).json({ success: false, error: 'Skill no encontrado' });
            return res.status(200).json({ success: true, skill });
        }

        return res.status(200).json({
            success: true,
            skills: listSkills(),
            hasApiKey: hasAnthropicKey(),
            model: AGENT_MODEL
        });
    } catch (error) {
        console.error('❌ [BrendaAgent] skills error:', error);
        return res.status(500).json({ success: false, error: 'No se pudieron cargar los skills', detail: error.message });
    }
}
