import { getRedisClient, getCandidateById, saveMessage } from '../utils/storage.js';
import { requireSuperAdmin } from '../utils/agent-ia.js';
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

const HOST = process.env.PUBLIC_BASE_URL || 'https://www.candidatic.com';

// /api/image?id=med_X → https://HOST/api/media/med_X.jpg (URL pública que Meta jala)
const toAbsoluteImageUrl = (u) => {
    if (!u) return u;
    const m = /[?&]id=([^&]+)/.exec(u);
    if (m) return `${HOST}/api/media/${m[1]}.jpg`;
    if (u.startsWith('/')) return `${HOST}${u}`;
    return u;
};

// Audio u otro media relativo: absolutizar SIN forzar extensión (no es .jpg).
const toAbsoluteMediaUrl = (u) => {
    if (!u) return u;
    if (u.startsWith('http')) return u;
    if (u.startsWith('/')) return `${HOST}${u}`;
    return u;
};

// Envía a UN candidato el bundle COMPLETO de la respuesta del banco, reproduciendo
// TODAS las variantes en orden: ubicación (maps), o audio/nota de voz, o la mezcla
// texto + N imágenes (cada elemento es su propio mensaje de WhatsApp). Cada candidato
// recibe exactamente los mismos mensajes que en el envío manual. { ok, sentCount }.
const sendBankBundleTo = async (candidate, proposal) => {
    const phone = String(candidate.whatsapp || '').replace(/\D/g, '');
    if (!phone) return { ok: false, error: 'sin teléfono' };

    const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
    if (!config || !config.instanceId || !config.token) return { ok: false, error: 'sin config de WhatsApp' };
    const { instanceId, token } = config;
    const now = () => new Date().toISOString();
    let sentCount = 0;

    // ── UBICACIÓN (maps) ──
    if (proposal.templateType === 'location' && proposal.location) {
        const loc = proposal.location;
        const r = await sendUltraMsgMessage(instanceId, token, phone, '', 'location', { name: loc.name, address: loc.address, lat: loc.lat, lng: loc.lng });
        if (r?.success) {
            sentCount++;
            await saveMessage(candidate.id, { from: 'me', content: `[Ubicación: ${loc.name || 'Mapa'}]`, type: 'location', timestamp: now(), meta: { bulk: true } }).catch(() => {});
        }
        return { ok: sentCount > 0, sentCount, error: sentCount ? null : 'falló ubicación' };
    }

    // ── AUDIO / nota de voz ──
    if (proposal.templateType === 'audio' && proposal.audioUrl) {
        const extra = {};
        if (proposal.voice) extra.voice = true;
        const r = await sendUltraMsgMessage(instanceId, token, phone, toAbsoluteMediaUrl(proposal.audioUrl), 'audio', extra);
        if (r?.success) {
            sentCount++;
            await saveMessage(candidate.id, { from: 'me', content: proposal.voice ? '🎤 Nota de voz' : '🎵 Audio', type: 'audio', mediaUrl: proposal.audioUrl, timestamp: now(), meta: { bulk: true } }).catch(() => {});
        }
        return { ok: sentCount > 0, sentCount, error: sentCount ? null : 'falló audio' };
    }

    // ── TEXTO + IMÁGENES (mezcla) ── cada uno es un mensaje independiente.
    if (proposal.messageText) {
        const text = substituteVariables(proposal.messageText, candidate); // resuelve {{nombre}} por candidato
        const r = await sendUltraMsgMessage(instanceId, token, phone, text, 'chat', {});
        if (r?.success) {
            sentCount++;
            await saveMessage(candidate.id, { from: 'me', content: text, timestamp: now(), meta: { bulk: true } }).catch(() => {});
        }
    }
    for (const imgUrl of (proposal.imageUrls || [])) {
        const r = await sendUltraMsgMessage(instanceId, token, phone, toAbsoluteImageUrl(imgUrl), 'image', {});
        if (r?.success) {
            sentCount++;
            await saveMessage(candidate.id, { from: 'me', content: '', type: 'image', mediaUrl: imgUrl, timestamp: now(), meta: { bulk: true } }).catch(() => {});
        }
        await new Promise((res) => setTimeout(res, 150)); // respiro entre imágenes
    }

    return { ok: sentCount > 0, sentCount, error: sentCount ? null : 'no se envió nada' };
};

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
                const r = await sendBankBundleTo(candidate, proposal);
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
