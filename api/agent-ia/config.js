import {
    requireSuperAdmin,
    hasAnthropicKey,
    getAgentsMd,
    setAgentsMd,
    getMemoryMd,
    setMemoryMd,
    getPendingMemory,
    AGENT_MODEL
} from '../utils/agent-ia.js';

// ════════════════════════════════════════════════════════════════════════════
// Agent IA — documentos y estado.
//   GET  → { agentsMd, memoryMd, pendingMemory, hasApiKey, model }
//   PUT  → edición HUMANA de un documento: { doc: 'agents'|'memory', content }
// Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

const MAX_DOC = 60000; // tope defensivo por documento

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    try {
        if (req.method === 'GET') {
            const [agentsMd, memoryMd, pendingMemory] = await Promise.all([
                getAgentsMd(),
                getMemoryMd(),
                getPendingMemory()
            ]);
            return res.status(200).json({
                success: true,
                agentsMd,
                memoryMd,
                pendingMemory,
                hasApiKey: hasAnthropicKey(),
                model: AGENT_MODEL
            });
        }

        if (req.method === 'PUT') {
            const doc = req.body?.doc;
            const content = String(req.body?.content ?? '').slice(0, MAX_DOC);
            if (doc === 'agents') {
                await setAgentsMd(content);
                return res.status(200).json({ success: true, agentsMd: content });
            }
            if (doc === 'memory') {
                await setMemoryMd(content);
                return res.status(200).json({ success: true, memoryMd: content });
            }
            return res.status(400).json({ success: false, error: 'doc debe ser "agents" o "memory"' });
        }

        return res.status(405).json({ success: false, error: 'Método no permitido' });
    } catch (error) {
        console.error('❌ [AgentIA] config error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
