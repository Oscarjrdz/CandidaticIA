/**
 * /api/cron/flow-incompletos
 * Vercel Cron — corre cada 15 minutos.
 *
 * Disparador "por AUSENCIA de respuesta" para el motor de flujos. El motor normal es
 * solo-evento (corre al COMPLETAR el perfil, desde api/ai/agent.js); este cron cubre el
 * caso opuesto: candidatos con perfil INCOMPLETO que llevan N horas sin responderle a
 * Brenda. Mismo espíritu que api/cron/reengagement.js, pero corriendo las acciones que el
 * reclutador armó en el lienzo (mensaje del banco, etiqueta, meter a proyecto, etc.).
 *
 * Solo aplica a flujos ACTIVOS cuyo nodo raíz es `inicio_incompleto_silencio`. Si no hay
 * ninguno activo, el cron regresa de inmediato SIN escanear candidatos (costo cero cuando
 * la feature no se usa).
 *
 * CADENCIA por candidato (contador de "pases", configurable en el nodo):
 *   - maxPasses = M → el candidato dispara mientras haya pasado <= M veces (total M+1
 *     disparos). Cada disparo suma +1 al contador (flow:silence:count:v1:<flowId>).
 *   - Entre disparo y disparo debe RE-ACUMULARSE el silencio: la elegibilidad se mide
 *     desde max(último mensaje del candidato, último disparo) — así no se dispara en cada
 *     corrida de 15 min, sino cada `silenceHours`.
 *   - El contador es de por vida (no se reinicia si el candidato responde) — coincide con
 *     "veces que ha pasado por este nodo".
 *
 * Nota: usa la MISMA muestra de 500 pendientes que reengagement (srandmember), así que un
 * candidato puede tardar un par de corridas en ser evaluado tras cruzar el silencio.
 */
import { getRedisClient, getCandidateById, isProfileComplete } from '../utils/storage.js';
import { getCachedConfig } from '../utils/cache.js';
import { runFlowForIncompleteSilence } from '../utils/flow-engine.js';
import { acquireProcessingLock, releaseProcessingLock } from '../utils/reminder-lock.js';

const FLOWS_KEY = 'flows:v1';
const COUNT_PREFIX = 'flow:silence:count:v1:';     // hash flowId → { candidateId: nºpases }
const FIRE_PREFIX  = 'flow:silence:lastfire:v1:';  // hash flowId → { candidateId: msÚltimoDisparo }

// Tope de disparos por corrida (todos los flujos juntos). Protege dos cosas a la vez:
//   1. El maxDuration de 60s — cada disparo puede mandar varios WhatsApp con pausa.
//   2. A Meta/WhatsApp: mandar cientos de mensajes de golpe (ej. al activar el flujo con
//      un backlog grande de incompletos viejos) puede marcar el número como spam. Con el
//      tope, el backlog se drena de forma gradual (25 × 96 corridas/día ≈ 2,400/día).
const MAX_FIRES_PER_RUN = 25;

export default async function handler(req, res) {
    // Seguridad: Vercel manda Authorization en los crons
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    // 1. Flujos ACTIVOS con nodo raíz de incompletos-en-silencio
    let flows;
    try {
        const raw = await getCachedConfig(redis, FLOWS_KEY);
        flows = raw ? JSON.parse(raw) : [];
    } catch {
        return res.status(500).json({ error: 'Cannot read flows' });
    }

    const silenceFlows = (Array.isArray(flows) ? flows : []).filter(f =>
        f.active && Array.isArray(f.nodes) && f.nodes.some(n => n.type === 'inicio_incompleto_silencio')
    );

    // Sin flujos de este tipo activos → salir sin escanear candidatos (costo cero)
    if (!silenceFlows.length) {
        return res.json({ success: true, skipped: 'no-active-silence-flows', fired: 0 });
    }

    // Modo forzado ("Enviar ya" desde UI, opcional): salta los checks de tiempo/contador
    const forceCandidateId = req.body?.forceCandidateId || null;

    // 2. Cargar candidatos incompletos (muestra del índice de pendientes, igual que reengagement)
    let candidates = [];
    try {
        if (forceCandidateId) {
            const c = await getCandidateById(forceCandidateId);
            candidates = c ? [c] : [];
        } else {
            const ids = await redis.srandmember('stats:list:pending', 500);
            if (ids?.length) {
                const pipe = redis.pipeline();
                ids.forEach(id => pipe.get(`candidate:${id}`));
                const rows = await pipe.exec();
                candidates = rows
                    .map(([, raw]) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } })
                    .filter(Boolean);
            }
        }
    } catch {
        return res.status(500).json({ error: 'Cannot fetch candidates' });
    }

    const now = Date.now();
    let fired = 0, skipped = 0, errors = 0;
    const log = [];

    for (const flow of silenceFlows) {
        const entry = flow.nodes.find(n => n.type === 'inicio_incompleto_silencio');
        const silenceMs = Math.max(1, Number(entry?.data?.silenceHours ?? 1)) * 3_600_000;
        const maxPasses = Math.max(0, Number(entry?.data?.maxPasses ?? 0));
        // Punto de partida = instante en que se activó el flujo (lo pone el PUT de flows.js).
        // Solo se dispara a candidatos que le escribieron a Brenda DESPUÉS de activar → nunca
        // se blastea el histórico y todos caen dentro de la ventana de 24h de Meta (su último
        // mensaje es posterior a la activación). Si no hay activatedAt (flujo viejo), 0 = sin filtro.
        const activeFromMs = flow.activatedAt ? new Date(flow.activatedAt).getTime() : 0;
        const countKey = `${COUNT_PREFIX}${flow.id}`;
        const fireKey  = `${FIRE_PREFIX}${flow.id}`;

        const ids = candidates.map(c => c.id);
        if (!ids.length) continue;

        // Lote: contador de pases y último disparo de todos los candidatos muestreados de una sola vez
        let countsRaw = [], firesRaw = [];
        try {
            [countsRaw, firesRaw] = await Promise.all([
                redis.hmget(countKey, ...ids),
                redis.hmget(fireKey, ...ids),
            ]);
        } catch {
            countsRaw = ids.map(() => null);
            firesRaw = ids.map(() => null);
        }

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            let lock = null;
            try {
                if (candidate.blocked) { skipped++; continue; }
                // Defensivo: el índice de pendientes debería traer solo incompletos, pero
                // si alguno ya completó, no lo perseguimos.
                if (isProfileComplete(candidate)) { skipped++; continue; }

                const passCount = Number(countsRaw[i] || 0);
                const lastMsgTs = candidate.lastUserMessageAt ? new Date(candidate.lastUserMessageAt).getTime() : 0;
                const lastFireTs = Number(firesRaw[i] || 0);
                const silentSince = Math.max(lastMsgTs, lastFireTs);

                if (!forceCandidateId) {
                    // Solo candidatos que interactuaron DESPUÉS de activar el flujo (histórico fuera).
                    if (!lastMsgTs || lastMsgTs < activeFromMs) { skipped++; continue; }
                    if (passCount > maxPasses) { skipped++; continue; }        // ya agotó sus pases
                    if (!silentSince) { skipped++; continue; }                 // nunca escribió → no aplica
                    if (now - silentSince < silenceMs) { skipped++; continue; } // aún no cumple el silencio
                }

                // Lock justo antes de disparar (evita doble ejecución/doble conteo)
                lock = await acquireProcessingLock(redis, 'flow_incompleto', `${flow.id}:${candidate.id}`);
                if (!lock) { skipped++; continue; }

                // Marca el pase ANTES de disparar (at-most-once): si el envío falla o la
                // función muere a media corrida (timeout de 60s), en la próxima corrida NO
                // se re-dispara todo el flujo — evita mensajes DUPLICADOS al candidato. El
                // costo es que un envío fallido "consume" un pase (con maxPasses>=1 hay
                // reintento en la siguiente ventana de silencio).
                await redis.pipeline()
                    .hincrby(countKey, candidate.id, 1)
                    .hset(fireKey, candidate.id, String(now))
                    .exec();

                await runFlowForIncompleteSilence(flow, candidate.id, candidate);

                fired++;
                log.push({ flowId: flow.id, candidateId: candidate.id, pass: passCount + 1 });
                console.log(`[FLOW-INCOMPLETOS] ✅ Flujo ${flow.id} → candidato ${candidate.id} (pase ${passCount + 1}/${maxPasses + 1})`);
            } catch (e) {
                console.error(`[FLOW-INCOMPLETOS] ❌ Flujo ${flow.id} candidato ${candidate.id}:`, e.message);
                errors++;
            } finally {
                if (lock) await releaseProcessingLock(redis, lock);
            }

            // Tope por corrida: corta y deja el resto para la próxima (drenado gradual)
            if (fired >= MAX_FIRES_PER_RUN) break;
        }

        if (fired >= MAX_FIRES_PER_RUN) break;
    }

    return res.json({
        success: true,
        fired,
        skipped,
        errors,
        flows: silenceFlows.length,
        capped: fired >= MAX_FIRES_PER_RUN,
        log,
        timestamp: new Date().toISOString(),
    });
}
