import {
    requireSuperAdmin,
    applyQuickReplyEdit,
    rejectQuickReplyEdit
} from '../utils/agent-ia.js';

// ════════════════════════════════════════════════════════════════════════════
// Agent IA — resolución de propuestas de EDICIÓN de respuestas del Banco.
//   POST { action: 'approve'|'reject', proposalId }
// 'approve' escribe el nuevo texto en candidatic:quick_replies. Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Método no permitido' });
    }

    const { action, proposalId } = req.body || {};
    if (!proposalId) return res.status(400).json({ success: false, error: 'Falta proposalId' });

    try {
        let result;
        if (action === 'approve') result = await applyQuickReplyEdit(proposalId);
        else if (action === 'reject') result = await rejectQuickReplyEdit(proposalId);
        else return res.status(400).json({ success: false, error: 'action debe ser "approve" o "reject"' });

        if (!result.success) return res.status(404).json(result);
        return res.status(200).json(result);
    } catch (error) {
        console.error('❌ [AgentIA] quick-reply edit error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
