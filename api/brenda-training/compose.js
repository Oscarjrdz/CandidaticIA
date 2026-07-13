import { getRedisClient } from '../utils/storage.js';
import {
    requireSuperAdmin,
    listAgents,
    listSkills,
    composeSystemPrompt
} from '../utils/brenda-training.js';

// ════════════════════════════════════════════════════════════════════════════
// COMPOSE — Previsualiza el system prompt ENSAMBLADO para un Agente × Skill.
// Es solo lectura: no envía nada, no gasta tokens de GPT. Sirve para que Oscar
// VEA exactamente qué recibiría el agente conversacional al juntar
// Brenda (base) + Agente (estilo) + Skill (hechos del cliente).
// GET /api/brenda-training/compose?agentId=...&skillId=...
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ success: false, error: 'Redis unavailable' });

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Metodo no permitido' });
    }

    try {
        const agentId = req.query?.agentId || null;
        const skillId = req.query?.skillId || null;

        const [agents, skills] = await Promise.all([listAgents(redis), listSkills(redis)]);
        const agent = agentId ? agents.find(a => a.id === agentId) : null;
        const skill = skillId ? skills.find(s => s.id === skillId) : null;

        const systemPrompt = composeSystemPrompt(agent, skill);

        return res.status(200).json({
            success: true,
            systemPrompt,
            agent: agent ? { id: agent.id, name: agent.name } : null,
            skill: skill ? { id: skill.id, name: skill.name } : null
        });
    } catch (error) {
        console.error('❌ [BrendaTraining] compose error:', error);
        return res.status(500).json({ success: false, error: 'No se pudo componer el prompt', detail: error.message });
    }
}
