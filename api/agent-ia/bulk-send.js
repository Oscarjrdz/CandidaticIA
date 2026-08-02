import { getRedisClient, getCandidateById, saveMessage, requireSuperAdmin } from '../utils/storage.js';
import { substituteVariables } from '../utils/shortcuts.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

// ════════════════════════════════════════════════════════════════════════════
// Endpoint de Ejecución y Polling de Envíos Masivos (Agent IA)
//
// POST /api/agent-ia/bulk-send → { action: 'execute' | 'cancel', proposalId }
// GET  /api/agent-ia/bulk-send?proposalId=... → Estado en vivo ({ status, sent, total, failed, logs })
//
// El proceso corre en servidor y persiste progreso en Redis (bulk_proposal:<id>:status)
// para no depender del navegador ni de la UI abierta.
// ════════════════════════════════════════════════════════════════════════════

const executeBulkSend = async (proposalId, proposal) => {
    const redis = getRedisClient();
    if (!redis || !proposal || !Array.isArray(proposal.candidates)) return;

    const statusKey = `bulk_proposal:${proposalId}:status`;
    const state = {
        status: 'sending',
        sent: 0,
        failed: 0,
        total: proposal.candidates.length,
        templateName: proposal.templateName,
        logs: [`[${new Date().toLocaleTimeString()}] 🚀 Iniciando envío masivo de "${proposal.templateName}" a ${proposal.candidates.length} candidatos...`]
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

        const candSummary = proposal.candidates[i];
        const candId = candSummary.id;

        try {
            const candidate = await getCandidateById(candId);
            if (!candidate) {
                state.failed++;
                state.logs.unshift(`[${new Date().toLocaleTimeString()}] ⚠️ Candidate ${candId} no encontrado. Saltando.`);
            } else {
                const phone = (candidate.whatsapp || candSummary.phone || '').replace(/\D/g, '');
                if (!phone) {
                    state.failed++;
                    state.logs.unshift(`[${new Date().toLocaleTimeString()}] ⚠️ Sin teléfono para ${candidate.nombreReal || candId}. Saltando.`);
                } else {
                    const resolvedInstance = candidate.incomingPhoneNumberId || candidate.instanceId;
                    const config = await getUltraMsgConfig(resolvedInstance);
                    if (!config || !config.instanceId || !config.token) {
                        state.failed++;
                        state.logs.unshift(`[${new Date().toLocaleTimeString()}] ❌ Sin config de WhatsApp para ${phone}.`);
                    } else {
                        const finalText = substituteVariables(proposal.messageText, candidate);
                        await sendUltraMsgMessage(config.instanceId, config.token, phone, finalText, 'chat', { priority: 0 });
                        await saveMessage(candId, {
                            from: 'bot',
                            content: finalText,
                            timestamp: new Date().toISOString()
                        });
                        state.sent++;
                        state.logs.unshift(`[${new Date().toLocaleTimeString()}] ✅ Enviado ${state.sent}/${state.total} a ${candidate.nombreReal || candidate.nombre || phone}`);
                    }
                }
            }
        } catch (err) {
            state.failed++;
            state.logs.unshift(`[${new Date().toLocaleTimeString()}] ❌ Error enviando a ${candId}: ${err.message}`);
        }

        // Actualizar progreso en Redis
        state.logs = state.logs.slice(0, 50); // Mantiene últimos 50 logs
        await redis.set(statusKey, JSON.stringify(state), 'EX', 7200);

        // Pequeña pausa de 200ms entre envíos para seguridad
        await new Promise((r) => setTimeout(r, 200));
    }

    state.status = 'completed';
    state.logs.unshift(`[${new Date().toLocaleTimeString()}] 🎉 Envío masivo completado. ${state.sent} exitosos, ${state.failed} fallidos.`);
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
