import { requireSuperAdmin } from '../utils/agent-ia.js';
import { getAgentLiveState, setAgentLiveState, getLiveQueue, getAvailableTags } from '../utils/agent-candidatic.js';

// ════════════════════════════════════════════════════════════════════════════
// AGENT CANDIDATIC — control y monitor del modo de atención automática en vivo.
//   GET  → { state:{on,since,tags}, queue:[{id,name,phone,tag}], availableTags }
//   POST { action:'on'|'off', tags:[] } → prende/apaga; al prender exige ≥1 etiqueta
// Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    try {
        if (req.method === 'GET') {
            const state = await getAgentLiveState();
            const [queue, availableTags] = await Promise.all([
                state.on ? getLiveQueue(state.tags) : Promise.resolve([]),
                getAvailableTags()
            ]);
            return res.status(200).json({ success: true, state, queue, availableTags });
        }

        if (req.method === 'POST') {
            const { action, tags } = req.body || {};
            const on = action === 'on';
            const result = await setAgentLiveState({ on, tags });
            if (result.error) {
                return res.status(result.needsTags ? 400 : 500).json({ success: false, ...result });
            }
            const queue = result.state.on ? await getLiveQueue(result.state.tags) : [];
            return res.status(200).json({ success: true, state: result.state, queue });
        }

        return res.status(405).json({ success: false, error: 'Método no permitido' });
    } catch (error) {
        console.error('❌ [AgentCandidatic] live-agent error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
