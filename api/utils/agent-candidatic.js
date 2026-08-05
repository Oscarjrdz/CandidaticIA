/**
 * AGENT CANDIDATIC — estado y cola del modo de atención automática en vivo.
 *
 * Es la GENERALIZACIÓN (por producto, no por cliente) del viejo agent-katcon:
 * cuando está ON para ciertas etiquetas, el servidor atiende a los candidatos que
 * se van completando de esas etiquetas — el LLM lee la skill de la etiqueta y decide
 * qué mandar/responder (ese motor de envío se conecta en un paso posterior).
 *
 * LA COLA ES EVENT-DRIVEN, NO UN POOL HISTÓRICO: arranca VACÍA en cada activación
 * (regla de Oscar: "a partir de activar agente y seleccionar la(s) etiqueta(s), todos
 * los candidatos que se completan serán respondidos" — los que ya estaban completos
 * ANTES de prender no cuentan). Se llena solo vía el hook `maybeEnqueueForLiveAgent()`,
 * llamado desde el extractor (api/ai/agent.js) en el instante exacto en que un candidato
 * pasa a completo (mismo punto de enganche que el viejo agent-katcon, generalizado).
 *
 * Estado en Redis:
 *   candidatic:agent_live       = JSON { on, since, tags: [nombres canónicos] }
 *   candidatic:agent_live:queue = JSON [{ id, name, phone, tag, completedAt }] (cap 200, más reciente primero)
 *   candidatic:agent_live:stats = JSON { totalAttended, totalGoals, totalAttendingMs, totalAwakeMs }
 *
 * MÉTRICAS (acumulativas, sobreviven apagar/prender):
 *   - atendidos      → cuántos candidatos terminaron con acción tomada (status 'done').
 *   - goles          → cuántas veces el agente juzgó que cumplió el OBJETIVO real de la
 *                      skill (no solo "mandé un mensaje"). Ver agent-attend.js: es una
 *                      autoevaluación explícita del propio modelo (tool marcar_gol), NO
 *                      un conteo automático de envíos.
 *   - tiempo atendiendo → suma de los segundos que el motor pasó REALMENTE procesando
 *                      candidatos (llamando a Claude, mandando mensajes, etc.).
 *   - tiempo despierto  → suma de los segundos que el toggle ha estado prendido (incluye
 *                      los ratos sin nadie que atender, no solo el procesamiento activo).
 */
import { getRedisClient } from './storage.js';
import { resolveTagName, getTagCounts } from './agent-ia.js';

const KEY_STATE = 'candidatic:agent_live';
const KEY_QUEUE = 'candidatic:agent_live:queue';
const KEY_STATS = 'candidatic:agent_live:stats';
const QUEUE_CAP = 200;

const normTag = (t) => String(typeof t === 'string' ? t : t?.name || '').trim().toUpperCase();

export async function getAgentLiveState() {
    const redis = getRedisClient();
    if (!redis) return { on: false, since: 0, tags: [] };
    try {
        const raw = await redis.get(KEY_STATE);
        const s = raw ? JSON.parse(raw) : null;
        return {
            on: !!s?.on,
            since: Number(s?.since) || 0,
            tags: Array.isArray(s?.tags) ? s.tags.filter(Boolean) : []
        };
    } catch {
        return { on: false, since: 0, tags: [] };
    }
}

// Prende/apaga y fija las etiquetas. Al prender exige ≥1 etiqueta (resuelta a su
// nombre canónico). `since` se fija al momento de prender (corte no-retroactivo) y
// se conserva si ya estaba ON. Devuelve { state } | { needsTags } | { error }.
export async function setAgentLiveState({ on, tags }) {
    const redis = getRedisClient();
    if (!redis) return { error: 'Redis no disponible' };

    const prev = await getAgentLiveState();
    const turningOn = on === true || String(on).toLowerCase() === 'true';

    if (!turningOn) {
        // Al apagar, el tiempo que estuvo prendido se acumula a "tiempo despierto" —
        // esta es la ÚNICA vez que se suma (mientras sigue ON, se calcula en vivo sumando
        // el tramo actual en getLiveStats(), sin escribir a Redis en cada lectura).
        if (prev.on && prev.since) {
            await addToStat('totalAwakeMs', Date.now() - prev.since);
        }
        const state = { on: false, since: 0, tags: [] };
        await redis.set(KEY_STATE, JSON.stringify(state));
        return { success: true, state };
    }

    // Resolver etiquetas a nombres canónicos (o conservar las previas si no mandan).
    let canonical = [];
    if (Array.isArray(tags) && tags.length) {
        for (const t of tags) {
            const c = await resolveTagName(t);
            if (c && !canonical.includes(c)) canonical.push(c);
        }
    } else {
        canonical = prev.tags;
    }

    if (!canonical.length) {
        return { needsTags: true, error: 'Para prender Agent Candidatic necesitas al menos una etiqueta válida. ¿A qué etiqueta(s) atiendo?' };
    }

    // Activación EXPLÍCITA (botón o comando de chat) → cola limpia: arranca vacía y
    // solo se llena con quien se complete de aquí en adelante. Si ya estaba ON y
    // vuelves a prender (ej. cambiaste etiquetas), también se reinicia: es un nuevo
    // "turno de atención".
    const state = {
        on: true,
        tags: canonical,
        since: Date.now()
    };
    await redis.set(KEY_STATE, JSON.stringify(state));
    await redis.del(KEY_QUEUE);
    return { success: true, state };
}

// Cola persistida (NO se recalcula desde Redis cada vez): se lee tal cual quedó
// guardada por el hook event-driven. Más reciente primero.
export async function getLiveQueue() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get(KEY_QUEUE);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

// Vacía la cola completa (botón "Vaciar todos" del panel). No toca a los candidatos
// ni sus datos reales — solo la lista de "en espera/atendidos" que se muestra.
export async function clearQueue() {
    const redis = getRedisClient();
    if (!redis) return { error: 'Redis no disponible' };
    await redis.del(KEY_QUEUE);
    return { success: true };
}

// Quita UN candidato de la cola (botón "Eliminar" por fila). Tampoco toca al candidato
// real — solo lo saca de esta lista.
export async function removeQueueEntry(candidateId) {
    const redis = getRedisClient();
    if (!redis) return { error: 'Redis no disponible' };
    const queue = await getLiveQueue();
    const next = queue.filter((q) => q.id !== candidateId);
    if (next.length === queue.length) return { error: 'Ese candidato ya no estaba en la cola.' };
    await redis.set(KEY_QUEUE, JSON.stringify(next));
    return { success: true };
}

// Actualiza el status/nota de UNA entrada de la cola (la usa el motor de atención:
// pending → attending → done | waiting | error). No falla si ya no está en la cola
// (pudo limpiarse por un re-encendido mientras se procesaba).
export async function updateQueueEntryStatus(candidateId, patch) {
    const redis = getRedisClient();
    if (!redis) return;
    try {
        const queue = await getLiveQueue();
        const idx = queue.findIndex((q) => q.id === candidateId);
        if (idx < 0) return;
        queue[idx] = { ...queue[idx], ...patch, updatedAt: new Date().toISOString() };
        await redis.set(KEY_QUEUE, JSON.stringify(queue));
    } catch { /* no crítico */ }
}

// ── MÉTRICAS ───────────────────────────────────────────────────────────────────
async function getRawStats() {
    const redis = getRedisClient();
    if (!redis) return { totalAttended: 0, totalGoals: 0, totalAttendingMs: 0, totalAwakeMs: 0 };
    try {
        const raw = await redis.get(KEY_STATS);
        const s = raw ? JSON.parse(raw) : null;
        return {
            totalAttended: Number(s?.totalAttended) || 0,
            totalGoals: Number(s?.totalGoals) || 0,
            totalAttendingMs: Number(s?.totalAttendingMs) || 0,
            totalAwakeMs: Number(s?.totalAwakeMs) || 0
        };
    } catch {
        return { totalAttended: 0, totalGoals: 0, totalAttendingMs: 0, totalAwakeMs: 0 };
    }
}

async function addToStat(key, amount) {
    const redis = getRedisClient();
    if (!redis || !amount) return;
    const stats = await getRawStats();
    stats[key] = (stats[key] || 0) + amount;
    await redis.set(KEY_STATS, JSON.stringify(stats));
}

// Un candidato quedó 'done' (el motor le tomó acción). +1 al contador de atendidos.
export async function recordAttended() {
    await addToStat('totalAttended', 1);
}

// El propio modelo juzgó que cumplió el OBJETIVO real de la skill (no solo "mandé un
// mensaje") — ver marcar_gol en agent-attend.js. +1 al contador de goles.
export async function recordGoal() {
    await addToStat('totalGoals', 1);
}

// Suma milisegundos de procesamiento REAL (una corrida de attendLiveCandidate), sin
// importar si terminó en done/waiting/error — el tiempo se gastó igual.
export async function recordAttendingDuration(ms) {
    await addToStat('totalAttendingMs', ms);
}

// Métricas para el panel: atendidos, goles, tiempo atendiendo (procesamiento real) y
// tiempo despierto (toggle ON, acumulado). Si sigue ON ahora mismo, suma el tramo en
// curso EN VIVO (sin escribir a Redis) para que el número no se quede congelado.
export async function getLiveStats() {
    const [stats, state] = await Promise.all([getRawStats(), getAgentLiveState()]);
    const liveAwakeMs = state.on && state.since ? (Date.now() - state.since) : 0;
    return {
        totalAttended: stats.totalAttended,
        totalGoals: stats.totalGoals,
        totalAttendingMs: stats.totalAttendingMs,
        totalAwakeMs: stats.totalAwakeMs + liveAwakeMs
    };
}

// ── HOOK EVENT-DRIVEN ─────────────────────────────────────────────────────────
// Se llama desde el extractor (api/ai/agent.js) en el MOMENTO EXACTO en que un
// candidato pasa a completo (mismo punto que el viejo agent-katcon, generalizado
// a cualquier etiqueta). Fire-and-forget: nunca bloquea ni rompe el extractor.
//
// Candados: ① Agent Candidatic ON, ② el candidato trae alguna de las etiquetas
// activas, ③ ningún humano intervino (!blocked) — igual que agent-katcon.
// El corte no-retroactivo es automático: esta función solo se invoca quien ACABA
// de completar en este turno (lo garantiza el caller), y `since` siempre es anterior
// a "ahora", así que todo lo que llega aquí es, por definición, posterior a la activación.
//
// Devuelve la entrada agregada (o null si no aplicó ningún candado) para que el
// caller sepa si debe disparar también el motor de atención (agent-attend.js).
export async function maybeEnqueueForLiveAgent(candidateId, candidateSnapshot) {
    try {
        const redis = getRedisClient();
        if (!redis) return null;

        const state = await getAgentLiveState();
        if (!state.on || !state.tags.length) return null;

        const c = candidateSnapshot;
        if (!c || !c.id || c.blocked) return null;

        const candTags = Array.isArray(c.tags) ? c.tags.map(normTag) : [];
        const matchedTag = state.tags.find((t) => candTags.includes(normTag(t)));
        if (!matchedTag) return null;

        const queue = await getLiveQueue();
        if (queue.some((q) => q.id === c.id)) return null; // ya estaba en la cola

        const cleanPhone = String(c.whatsapp || '').replace(/\D/g, '');
        const entry = {
            id: c.id,
            name: c.nombreReal || c.nombre || c.id,
            phone: cleanPhone ? `+${cleanPhone}` : 'Sin WhatsApp',
            tag: matchedTag,
            status: 'pending', // pending → attending → done | waiting | error
            completedAt: new Date().toISOString()
        };
        const next = [entry, ...queue].slice(0, QUEUE_CAP);
        await redis.set(KEY_QUEUE, JSON.stringify(next));
        return entry;
    } catch (e) {
        // Fire-and-forget: jamás propaga error al extractor.
        console.error('[AGENT-CANDIDATIC] maybeEnqueueForLiveAgent:', e?.message);
        return null;
    }
}

// Nombres de etiquetas disponibles (para el selector del panel), con su conteo.
export async function getAvailableTags() {
    const data = await getTagCounts();
    if (!data) return [];
    return data.tags.filter((t) => t.count > 0).map((t) => ({ name: t.name, count: t.count }));
}
