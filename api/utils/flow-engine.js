import { getRedisClient, isProfileComplete, updateCandidate, saveMessage } from './storage.js';
import { getCachedConfig } from './cache.js';
import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';
import { substituteVariables } from './shortcuts.js';

// ════════════════════════════════════════════════════════════════════════════
// MOTOR DE FLOWS — ejecución determinística de automatizaciones post-extracción.
//
// Se dispara UNA VEZ por candidato, en el instante exacto en que Brenda termina
// de extraer sus datos (paso2Estado → 'completo'), desde api/ai/agent.js — mismo
// patrón fire-and-forget que api/utils/agent-katcon.js. NO hay cron de barrido
// (decisión explícita: solo evento) y NADA aquí llama a un LLM — es comparación
// pura de campos ya extraídos contra criterios configurados en el lienzo.
//
// Cada flujo es un grafo (nodes/edges armado en el editor React Flow). Se recorre
// en orden topológico; cada nodo resuelve un booleano "pasó":
//   - nodos de filtro/condición: pasan si el candidato cumple el criterio.
//   - nodos con VARIOS edges entrantes solo pasan si TODOS sus predecesores
//     pasaron (AND) — así se implementa el fan-in del boceto original
//     (etiqueta → [edad, municipio, categoría, escolaridad] → mandar WhatsApp).
//   - nodos de acción (mandar WhatsApp / agregar etiqueta) y el nodo "contador"
//     siempre "pasan" una vez ejecutados, para no dejar la cadena a medias si
//     el envío falla por un error transitorio (dedupe es de una sola vez).
// ════════════════════════════════════════════════════════════════════════════

const FLOWS_KEY = 'flows:v1';
const QUICK_REPLIES_KEY = 'candidatic:quick_replies';
export const EXEC_SET_PREFIX = 'flow:executed:v1:';
export const COUNTER_PREFIX = 'flow:counter:v1:';

function getCandidateAge(candidate) {
    if (Number.isFinite(candidate?.edad)) return Number(candidate.edad);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(candidate?.fechaNacimiento || ''));
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    const birth = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (Number.isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const hadBirthdayThisYear = (now.getMonth() > birth.getMonth()) ||
        (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
    if (!hadBirthdayThisYear) age -= 1;
    return age;
}

function topoSort(nodes, edges) {
    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    const adj = new Map(nodes.map(n => [n.id, []]));
    for (const e of edges) {
        if (!adj.has(e.source) || !inDegree.has(e.target)) continue;
        adj.get(e.source).push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }

    const queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const order = [];
    const seen = new Set();

    while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        order.push(byId.get(id));
        for (const next of adj.get(id) || []) {
            inDegree.set(next, inDegree.get(next) - 1);
            if (inDegree.get(next) === 0) queue.push(next);
        }
    }

    // Nodos que quedaron fuera (ciclo o desconectados de la raíz) se ignoran —
    // un ciclo en el lienzo no debe tumbar la ejecución del resto del flujo.
    return order;
}

function buildIncomingMap(edges) {
    const incoming = new Map();
    for (const e of edges) {
        if (!incoming.has(e.target)) incoming.set(e.target, []);
        incoming.get(e.target).push(e.source);
    }
    return incoming;
}

async function evaluateOrExecute(node, candidate, flowId, redis) {
    const data = node.data || {};

    switch (node.type) {
        case 'inicio': {
            const filter = data.profileFilter || 'todos';
            if (filter === 'todos') return true;
            if (filter === 'active') return !candidate.blocked;
            if (filter === 'completo') return isProfileComplete(candidate);
            if (filter === 'incompleto') return !isProfileComplete(candidate);
            return true;
        }

        case 'etiqueta': {
            const mode = data.mode || 'todas';
            const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
            if (mode === 'todas') return true;
            if (mode === 'ninguna') return tags.length === 0;
            if (mode === 'especifica') {
                if (!data.tag) return true; // sin configurar aún → no bloquea
                return tags.includes(data.tag);
            }
            return true;
        }

        case 'condicion_genero': {
            const values = Array.isArray(data.generos) ? data.generos : [];
            if (!values.length) return true;
            return values.includes(candidate.genero);
        }

        case 'condicion_edad': {
            const { min, max } = data;
            if (min == null && max == null) return true;
            const age = getCandidateAge(candidate);
            if (age == null) return false;
            if (min != null && age < min) return false;
            if (max != null && age > max) return false;
            return true;
        }

        case 'condicion_municipio': {
            const values = Array.isArray(data.municipios) ? data.municipios : [];
            if (!values.length) return true;
            return values.includes(candidate.municipio);
        }

        case 'condicion_categoria': {
            const values = Array.isArray(data.categorias) ? data.categorias : [];
            if (!values.length) return true;
            return values.includes(candidate.categoria);
        }

        case 'condicion_escolaridad': {
            const values = Array.isArray(data.escolaridades) ? data.escolaridades : [];
            if (!values.length) return true;
            return values.includes(candidate.escolaridad);
        }

        case 'accion_whatsapp': {
            if (!data.quickReplyId) return true; // sin configurar → no rompe la cadena
            try {
                const raw = await getCachedConfig(redis, QUICK_REPLIES_KEY);
                const replies = raw ? JSON.parse(raw) : [];
                const qr = replies.find(r => r.id === data.quickReplyId);
                if (!qr || !qr.message) return true;

                const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
                if (!config?.token || !config?.instanceId) throw new Error('sin credenciales de WhatsApp');

                const cleanTo = String(candidate.whatsapp).replace(/\D/g, '');
                const text = substituteVariables(qr.message, candidate);
                const sendResult = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, text, 'chat', { priority: 1 });
                if (sendResult?.success) {
                    await saveMessage(candidate.id, {
                        from: 'me', content: text, timestamp: new Date().toISOString(),
                        meta: { flow: true, flowId, nodeId: node.id }
                    }).catch(() => {});
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_whatsapp ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_etiqueta': {
            if (!data.tag) return true;
            try {
                const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
                if (!tags.includes(data.tag)) {
                    const nextTags = [...tags, data.tag];
                    await updateCandidate(candidate.id, { tags: nextTags });
                    candidate.tags = nextTags; // mantener el snapshot en memoria en sync para el resto de la corrida
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_etiqueta ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_quitar_etiqueta': {
            if (!data.tag) return true;
            try {
                const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
                if (tags.includes(data.tag)) {
                    const nextTags = tags.filter(t => t !== data.tag);
                    await updateCandidate(candidate.id, { tags: nextTags });
                    candidate.tags = nextTags; // mantener el snapshot en memoria en sync para el resto de la corrida
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_quitar_etiqueta ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'contador': {
            try {
                await redis.sadd(`${COUNTER_PREFIX}${flowId}:${node.id}`, candidate.id);
            } catch (e) {
                console.error(`[FLOW-ENGINE] contador ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        default:
            return true;
    }
}

async function runOneFlow(redis, flow, candidateId, candidate) {
    const claimed = await redis.sadd(`${EXEC_SET_PREFIX}${flow.id}`, candidateId);
    if (claimed === 0) return; // ya ejecutado para este candidato (webhook reintentado)

    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    if (!nodes.length) return;

    const order = topoSort(nodes, edges);
    const incoming = buildIncomingMap(edges);
    const passed = new Map();

    for (const node of order) {
        const preds = incoming.get(node.id) || [];
        const eligible = preds.length === 0 || preds.every(p => passed.get(p) === true);
        if (!eligible) {
            passed.set(node.id, false);
            continue;
        }
        passed.set(node.id, await evaluateOrExecute(node, candidate, flow.id, redis));
    }
}

// Punto de entrada — llamado fire-and-forget desde api/ai/agent.js con el snapshot
// del candidato ya mergeado (para no releer Redis). Nunca lanza: todo error se traga.
export async function runFlowsForCandidate(candidateId, candidateSnapshot) {
    try {
        const redis = getRedisClient();
        if (!redis || !candidateSnapshot?.id || !candidateSnapshot?.whatsapp) return;

        const raw = await getCachedConfig(redis, FLOWS_KEY);
        const flows = raw ? JSON.parse(raw) : [];
        const active = flows.filter(f => f.active && Array.isArray(f.nodes) && f.nodes.length);
        if (!active.length) return;

        await Promise.allSettled(active.map(flow => runOneFlow(redis, flow, candidateId, { ...candidateSnapshot })));
    } catch (e) {
        console.error('[FLOW-ENGINE] runFlowsForCandidate:', e?.message);
    }
}
