import { requireSuperAdmin } from '../utils/agent-ia.js';
import { getLiveFeed } from '../utils/agent-live-feed.js';

// ════════════════════════════════════════════════════════════════════════════
// AGENT CANDIDATIC — feed de narración del motor de atención automática.
//   GET → { success, feed: [{id, ts, kind, text, candidateId, candidateName, tag}] }
// AgentChat.jsx lo sondea para narrar acciones/dudas del motor en el chat. Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Método no permitido' });
    }

    try {
        const feed = await getLiveFeed();
        return res.status(200).json({ success: true, feed });
    } catch (error) {
        console.error('❌ [AgentCandidatic] live-feed error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
