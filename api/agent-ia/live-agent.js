import { requireSuperAdmin } from '../utils/agent-ia.js';
import {
    getAgentLiveState, setAgentLiveState, getLiveQueue, getAvailableTags,
    getLiveStats, clearQueue, removeQueueEntry
} from '../utils/agent-candidatic.js';

// ════════════════════════════════════════════════════════════════════════════
// AGENT CANDIDATIC — control y monitor del modo de atención automática en vivo.
//   GET  → { state, queue, availableTags, stats:{totalAttended,totalGoals,totalAttendingMs,totalAwakeMs} }
//   POST { action:'on'|'off', tags:[] }        → prende/apaga; al prender exige ≥1 etiqueta
//   POST { action:'clear' }                    → vacía toda la cola (no toca candidatos reales)
//   POST { action:'remove', candidateId }      → quita UN candidato de la cola
// Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    try {
        if (req.method === 'GET') {
            // La cola es event-driven (no se recalcula de un pool): se muestra tal cual,
            // incluso apagado, para poder revisar quién se atendió en el último turno.
            const [state, queue, availableTags, stats] = await Promise.all([
                getAgentLiveState(),
                getLiveQueue(),
                getAvailableTags(),
                getLiveStats()
            ]);
            return res.status(200).json({ success: true, state, queue, availableTags, stats });
        }

        if (req.method === 'POST') {
            const { action, tags, candidateId } = req.body || {};

            if (action === 'clear') {
                const result = await clearQueue();
                if (result.error) return res.status(500).json({ success: false, ...result });
                return res.status(200).json({ success: true, queue: [] });
            }

            if (action === 'remove') {
                if (!candidateId) return res.status(400).json({ success: false, error: 'Falta candidateId' });
                const result = await removeQueueEntry(candidateId);
                if (result.error) return res.status(404).json({ success: false, ...result });
                return res.status(200).json({ success: true, queue: await getLiveQueue() });
            }

            const on = action === 'on';
            const result = await setAgentLiveState({ on, tags });
            if (result.error) {
                return res.status(result.needsTags ? 400 : 500).json({ success: false, ...result });
            }
            const queue = await getLiveQueue(); // recién limpiada si se prendió; conservada si se apagó
            return res.status(200).json({ success: true, state: result.state, queue });
        }

        return res.status(405).json({ success: false, error: 'Método no permitido' });
    } catch (error) {
        console.error('❌ [AgentCandidatic] live-agent error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
