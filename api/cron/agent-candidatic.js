import { getAgentLiveState, getLiveQueue } from '../utils/agent-candidatic.js';
import { attendLiveCandidate } from '../utils/agent-attend.js';

// ════════════════════════════════════════════════════════════════════════════
// CRON: AGENT CANDIDATIC — RED DE SEGURIDAD del motor de atención (agent-attend.js).
//
// El disparador PRINCIPAL es event-driven en el extractor (api/ai/agent.js), sin
// await (fire-and-forget) para no retrasar la respuesta al candidato. El problema:
// Vercel puede congelar esa función en cuanto se responde el webhook de WhatsApp,
// antes de que la llamada a Claude termine — el candidato queda 'attending' colgado
// para siempre (confirmado en producción). Mismo patrón que el backstop de
// agent-katcon: este cron barre la cola cada 15 min y reintenta SOLO lo que se
// quedó a medias. Esta corrida no compite por tiempo con el webhook, así que sí
// alcanza a terminar.
//
// Reintenta: status 'pending' (nunca arrancó) o 'attending' viejo (>3 min, colgado).
// NO reintenta 'done' (ya se resolvió) ni 'waiting'/'error' (esos requieren que Oscar
// decida algo — no hay que insistir solo, ver el feed del chat del agente).
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    // Auth de cron (igual que send-reminders / agent-katcon): solo Vercel Cron con el secreto.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const state = await getAgentLiveState();
        if (!state.on) {
            return res.status(200).json({ ok: true, skipped: 'Agent Candidatic apagado' });
        }

        const queue = await getLiveQueue();
        const now = Date.now();
        const STALE_MS = 3 * 60 * 1000;
        const stuck = queue.filter((q) => {
            if (q.status === 'pending') return true;
            if (q.status === 'attending') {
                const t = new Date(q.updatedAt || q.completedAt || 0).getTime();
                return (now - t) > STALE_MS;
            }
            return false;
        });

        for (const entry of stuck) {
            await attendLiveCandidate(entry.id, entry.tag);
        }

        return res.status(200).json({
            ok: true,
            enCola: queue.length,
            atorados: stuck.length,
            reintentados: stuck.map((e) => ({ id: e.id, nombre: e.name })),
            nota: 'red de seguridad; el disparo principal es event-driven en el extractor'
        });
    } catch (error) {
        console.error('[AGENT-CANDIDATIC-CRON] error:', error);
        return res.status(500).json({ ok: false, error: error.message });
    }
}
