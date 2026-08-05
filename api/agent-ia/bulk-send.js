import { getRedisClient, getCandidateById } from '../utils/storage.js';
import { requireSuperAdmin } from '../utils/agent-ia.js';
import { sendMessageBundleTo } from '../utils/agent-send.js';

// ════════════════════════════════════════════════════════════════════════════
// Endpoint de Ejecución y Polling de Envíos Masivos (Agent IA)
//
// POST /api/agent-ia/bulk-send → { action: 'execute' | 'cancel', proposalId }
// GET  /api/agent-ia/bulk-send?proposalId=... → Estado en vivo ({ status, sent, total, failed, logs })
//
// El proceso corre en servidor y persiste progreso en Redis (bulk_proposal:<id>:status)
// para no depender del navegador ni de la UI abierta. El envío real (texto/imágenes/
// ubicación/audio) vive en utils/agent-send.js, compartido con el motor de Agent
// Candidatic (agent-attend.js) para no duplicar esa lógica.
// ════════════════════════════════════════════════════════════════════════════

const executeBulkSend = async (proposalId, proposal) => {
    const redis = getRedisClient();
    if (!redis || !proposal || !Array.isArray(proposal.candidates)) return;

    const statusKey = `bulk_proposal:${proposalId}:status`;
    const mix = proposal.mixSummary ? ` (${proposal.mixSummary})` : '';
    const state = {
        status: 'sending',
        sent: 0,
        failed: 0,
        total: proposal.candidates.length,
        templateName: proposal.templateName,
        logs: [`[${new Date().toLocaleTimeString()}] 🚀 Enviando "${proposal.templateName}"${mix} a ${proposal.candidates.length} candidatos...`]
    };

    await redis.set(statusKey, JSON.stringify(state), 'EX', 7200);

    for (let i = 0; i < proposal.candidates.length; i++) {
        // Verificar si fue cancelado
        try {
            const currentRaw = await redis.get(statusKey);
            const currentState = currentRaw ? JSON.parse(currentRaw) : null;
            if (currentState?.status === 'canceled') {
                state.status = 'canceled';
                state.logs.unshift(`[${new Date().toLocaleTimeString()}] 🛑 Envío masivo cancelado por el usuario.`);
                await redis.set(statusKey, JSON.stringify(state), 'EX', 7200);
                return;
            }
        } catch (_) { /* ignore */ }

        const candId = proposal.candidates[i].id;

        try {
            const candidate = await getCandidateById(candId);
            if (!candidate) {
                state.failed++;
                state.logs.unshift(`[${new Date().toLocaleTimeString()}] ⚠️ Candidato ${candId} no encontrado. Saltando.`);
            } else {
                const r = await sendMessageBundleTo(candidate, proposal, { bulk: true });
                const nombre = candidate.nombreReal || candidate.nombre || candId;
                if (r.ok) {
                    state.sent++;
                    state.logs.unshift(`[${new Date().toLocaleTimeString()}] ✅ ${state.sent}/${state.total} → ${nombre} (${r.sentCount} msj)`);
                } else {
                    state.failed++;
                    state.logs.unshift(`[${new Date().toLocaleTimeString()}] ❌ ${nombre}: ${r.error}`);
                }
            }
        } catch (err) {
            state.failed++;
            state.logs.unshift(`[${new Date().toLocaleTimeString()}] ❌ Error enviando a ${candId}: ${err.message}`);
        }

        // Actualizar progreso en Redis
        state.logs = state.logs.slice(0, 50); // Mantiene últimos 50 logs
        await redis.set(statusKey, JSON.stringify(state), 'EX', 7200);

        // Pausa entre candidatos (anti-spam)
        await new Promise((res) => setTimeout(res, 250));
    }

    state.status = 'completed';
    state.logs.unshift(`[${new Date().toLocaleTimeString()}] 🎉 Envío completado. ${state.sent} exitosos, ${state.failed} fallidos.`);
    await redis.set(statusKey, JSON.stringify(state), 'EX', 7200);
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

    if (req.method === 'GET') {
        const proposalId = req.query?.proposalId;
        if (!proposalId) return res.status(400).json({ error: 'proposalId requerido' });

        const raw = await redis.get(`bulk_proposal:${proposalId}:status`);
        if (!raw) {
            return res.status(200).json({ success: true, state: { status: 'pending', sent: 0, total: 0, failed: 0, logs: [] } });
        }
        try {
            const state = JSON.parse(raw);
            return res.status(200).json({ success: true, state });
        } catch {
            return res.status(500).json({ error: 'Error deserializando estado de envío' });
        }
    }

    if (req.method === 'POST') {
        const { action, proposalId } = req.body || {};
        if (!proposalId) return res.status(400).json({ error: 'proposalId requerido' });

        if (action === 'cancel') {
            const statusKey = `bulk_proposal:${proposalId}:status`;
            const currentRaw = await redis.get(statusKey);
            const currentState = currentRaw ? JSON.parse(currentRaw) : { status: 'canceled' };
            currentState.status = 'canceled';
            await redis.set(statusKey, JSON.stringify(currentState), 'EX', 7200);
            return res.status(200).json({ success: true, message: 'Envío cancelado.' });
        }

        if (action === 'execute') {
            const rawProposal = await redis.get(`bulk_proposal:${proposalId}`);
            if (!rawProposal) {
                return res.status(404).json({ error: 'La propuesta de envío expiró o no existe.' });
            }
            const proposal = JSON.parse(rawProposal);

            // Iniciar ejecución en segundo plano (fire-and-forget serverless)
            executeBulkSend(proposalId, proposal).catch((e) => {
                console.error('[BulkSend AgentIA] Error in background execution:', e);
            });

            return res.status(200).json({
                success: true,
                message: 'Ejecución de envío iniciada en segundo plano.',
                proposalId
            });
        }

        return res.status(400).json({ error: 'Acción no válida' });
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
