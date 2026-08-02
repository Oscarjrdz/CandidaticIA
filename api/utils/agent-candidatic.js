/**
 * AGENT CANDIDATIC — estado y cola del modo de atención automática en vivo.
 *
 * Es la GENERALIZACIÓN (por producto, no por cliente) del viejo agent-katcon:
 * cuando está ON para ciertas etiquetas, el servidor atiende a los candidatos que
 * se van completando de esas etiquetas — el LLM lee la skill de la etiqueta y decide
 * qué mandar/responder (ese motor de envío se conecta en un paso posterior).
 *
 * Este módulo, por ahora, maneja el ESTADO (on/off, etiquetas, desde-cuándo) y la
 * COLA (candidatos completos de esas etiquetas) que consume la 3ª columna del panel.
 *
 * Estado en Redis: candidatic:agent_live = JSON { on, since, tags: [nombres canónicos] }
 */
import { getRedisClient } from './storage.js';
import { resolveTagName, getDetailedCandidatesList, getTagCounts } from './agent-ia.js';

const KEY_STATE = 'candidatic:agent_live';

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

    const state = {
        on: true,
        tags: canonical,
        since: prev.on && prev.since ? prev.since : Date.now()
    };
    await redis.set(KEY_STATE, JSON.stringify(state));
    return { success: true, state };
}

// Cola de atención: candidatos COMPLETOS de las etiquetas activas (unión, sin
// duplicados). Barato: reusa getDetailedCandidatesList (intersección de Sets).
// Nota: en esta primera etapa muestra el POOL de completos con esas etiquetas;
// cuando exista el motor, se distinguirá pendiente vs. ya atendido con precisión.
export async function getLiveQueue(tags, limitPerTag = 50) {
    const list = Array.isArray(tags) ? tags : [];
    const seen = new Set();
    const items = [];
    for (const tag of list) {
        const data = await getDetailedCandidatesList({ etiqueta: tag, estado: 'completos', limite: limitPerTag });
        if (data && !data.error && Array.isArray(data.candidates)) {
            for (const c of data.candidates) {
                if (seen.has(c.id)) continue;
                seen.add(c.id);
                items.push({ id: c.id, name: c.name, phone: c.phone, tag });
            }
        }
    }
    return items;
}

// Nombres de etiquetas disponibles (para el selector del panel), con su conteo.
export async function getAvailableTags() {
    const data = await getTagCounts();
    if (!data) return [];
    return data.tags.filter((t) => t.count > 0).map((t) => ({ name: t.name, count: t.count }));
}
