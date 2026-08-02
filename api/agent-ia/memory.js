import {
    requireSuperAdmin,
    approveMemoryProposal,
    rejectMemoryProposal,
    getPendingMemory,
    getMemoryMd
} from '../utils/agent-ia.js';

// ════════════════════════════════════════════════════════════════════════════
// Agent IA — resolución de propuestas de memoria (aprobar/rechazar).
//   POST { action: 'approve'|'reject', id }
// Devuelve el estado nuevo (memoryMd + pendingMemory) para que la UI refresque.
// Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Método no permitido' });
    }

    const { action, id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Falta id' });

    try {
        let result;
        if (action === 'approve') result = await approveMemoryProposal(id);
        else if (action === 'reject') result = await rejectMemoryProposal(id);
        else return res.status(400).json({ success: false, error: 'action debe ser "approve" o "reject"' });

        if (!result.success) return res.status(404).json(result);

        const [memoryMd, pendingMemory] = await Promise.all([getMemoryMd(), getPendingMemory()]);
        return res.status(200).json({ success: true, memoryMd, pendingMemory });
    } catch (error) {
        console.error('❌ [AgentIA] memory error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
