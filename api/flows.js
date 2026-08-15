import { getRedisClient, validateAdminSession, getCandidateByPhone, getCandidateById, getCandidatesForFlowList } from './utils/storage.js';
import { getCachedConfig, invalidateCache } from './utils/cache.js';
import { runFlowTest, runFlowForListCandidate } from './utils/flow-engine.js';
import { getBotVacancies, buildDateKeys, getCapturesByAllTags, getCapturesTotal } from './utils/agent-ia.js';

const REDIS_KEY = 'flows:v1';
const EXEC_SET_PREFIX = 'flow:executed:v1:';
const COUNTER_PREFIX = 'flow:counter:v1:';
const COUNTER_TS_PREFIX = 'flow:counter:ts:v1:'; // ZSET candidatoId → ms del primer paso (desglose por fecha)

// Rangos de fecha en zona horaria Monterrey (UTC-6 todo el año). Devuelve los ms de inicio
// de: hoy, ayer, lunes de esta semana y día 1 de este mes — para ZCOUNT sobre el ZSET.
const MTY_OFFSET_MS = 6 * 3600000;
function mtyDateStartMs(dateStr) {
    // dateStr = 'YYYY-MM-DD' (fecha local Monterrey) → ms UTC de las 00:00 Monterrey de ese día
    return new Date(`${dateStr}T00:00:00.000Z`).getTime() + MTY_OFFSET_MS;
}
function mtyRanges() {
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
    const yesterdayStr = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
    const todayStart = mtyDateStartMs(todayStr);
    const yesterdayStart = mtyDateStartMs(yesterdayStr);
    const dow = new Date(`${todayStr}T00:00:00.000Z`).getUTCDay(); // 0=Dom … 6=Sáb (del día calendario)
    const mondayStart = todayStart - ((dow + 6) % 7) * 86400000;    // lunes de esta semana
    const monthStart = mtyDateStartMs(`${todayStr.slice(0, 8)}01`); // día 1 del mes
    return { todayStart, yesterdayStart, mondayStart, monthStart };
}

// 51 municipios oficiales de Nuevo León (nombres canónicos, mismos valores que
// MUNICIPIO_MAP en api/utils/ai.js — no reinventar la lista aquí si esa cambia).
export const NL_MUNICIPIOS = [
    'Monterrey', 'Guadalupe', 'Apodaca', 'General Escobedo', 'San Nicolás de los Garza',
    'San Pedro Garza García', 'Santa Catarina', 'Benito Juárez', 'García', 'Pesquería',
    'General Zuazua', 'Santiago', 'Abasolo', 'Agualeguas', 'Los Aldamas', 'Allende',
    'Anáhuac', 'Aramberri', 'Bustamante', 'Cadereyta Jiménez', 'El Carmen', 'Cerralvo',
    'China', 'Ciénega de Flores', 'Doctor Arroyo', 'Doctor Coss', 'Doctor González',
    'Galeana', 'General Bravo', 'General Terán', 'General Treviño', 'General Zaragoza',
    'Los Herreras', 'Higueras', 'Hualahuises', 'Iturbide', 'Lampazos de Naranjo',
    'Linares', 'Marín', 'Melchor Ocampo', 'Mier y Noriega', 'Mina', 'Montemorelos',
    'Parás', 'Los Ramones', 'Rayones', 'Sabinas Hidalgo', 'Salinas Victoria', 'Hidalgo',
    'Vallecillo', 'Villaldama'
];

export const ESCOLARIDADES = ['Primaria', 'Secundaria', 'Preparatoria', 'Licenciatura', 'Técnica', 'Posgrado'];

async function getFlows(redis) {
    const raw = await getCachedConfig(redis, REDIS_KEY);
    return raw ? JSON.parse(raw) : [];
}

async function saveFlows(redis, flows) {
    await redis.set(REDIS_KEY, JSON.stringify(flows));
    invalidateCache(REDIS_KEY);
}

function defaultFlowNodes() {
    return {
        nodes: [
            { id: 'n1', type: 'inicio', position: { x: 80, y: 200 }, data: { profileFilter: 'completo' } }
        ],
        edges: []
    };
}

// Flujo MANUAL ("del pasado", no en vivo — ver comentario en flow-engine.js sobre
// inicio_lista): arranca con el nodo de lista filtrada en vez de "inicio".
function defaultFlowNodesLista() {
    return {
        nodes: [
            { id: 'n1', type: 'inicio_lista', position: { x: 80, y: 200 }, data: { profileFilter: 'todos', tags: [], within24h: false } }
        ],
        edges: []
    };
}

// Flujo de INCOMPLETOS EN SILENCIO (disparado por cron api/cron/flow-incompletos.js):
// arranca con el nodo que espera N horas de silencio de un candidato con perfil incompleto.
// silenceHours = horas sin responder para disparar; maxPasses = tope de veces que un
// candidato puede pasar por el nodo (0 = una sola vez).
function defaultFlowNodesIncompletos() {
    return {
        nodes: [
            { id: 'n1', type: 'inicio_incompleto_silencio', position: { x: 80, y: 200 }, data: { silenceHours: 1, maxPasses: 0 } }
        ],
        edges: []
    };
}

export default async function handler(req, res) {
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

    const { method } = req;
    const { id, meta, mode } = req.query;

    try {
        if (method === 'GET' && meta === '1') {
            const [categoriasRaw, chatTagsRaw] = await Promise.all([
                getCachedConfig(redis, 'candidatic_categories'),
                redis.get('candidatic:chat_tags')
            ]);
            const categorias = categoriasRaw ? JSON.parse(categoriasRaw) : [];
            // Misma fuente y mismo fallback que GET /api/tags (Chat Web / Proyectos) — para
            // que la lista de etiquetas sea idéntica en toda la app, no una versión ampliada.
            const chatTags = chatTagsRaw ? JSON.parse(chatTagsRaw) : [
                { name: 'Urgente', color: '#64748b' },
                { name: 'Entrevista', color: '#f97316' },
                { name: 'Contratado', color: '#eab308' },
                { name: 'Rechazado', color: '#22c55e' },
                { name: 'Duda', color: '#3b82f6' }
            ];
            const tags = chatTags.map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
            const vacanciesList = await getBotVacancies();
            const vacantes = vacanciesList.map(v => ({ id: v.id, name: v.name }));

            return res.status(200).json({
                success: true,
                municipios: NL_MUNICIPIOS,
                categorias,
                escolaridades: ESCOLARIDADES,
                tags,
                vacantes
            });
        }

        if (method === 'GET' && id && mode === 'counters') {
            const flows = await getFlows(redis);
            const flow = flows.find(f => f.id === id);
            if (!flow) return res.status(404).json({ success: false, error: 'Flow not found' });

            const counterNodeIds = (flow.nodes || []).filter(n => n.type === 'contador').map(n => n.id);
            if (!counterNodeIds.length) return res.status(200).json({ success: true, counters: {} });

            const { todayStart, yesterdayStart, mondayStart, monthStart } = mtyRanges();

            // Por nodo: total (SET, incluye histórico) + desglose por fecha (ZSET de timestamps).
            const pipeline = redis.pipeline();
            counterNodeIds.forEach(nodeId => {
                const setKey = `${COUNTER_PREFIX}${flow.id}:${nodeId}`;
                const tsKey = `${COUNTER_TS_PREFIX}${flow.id}:${nodeId}`;
                pipeline.scard(setKey);                                  // total
                pipeline.zcount(tsKey, todayStart, '+inf');             // hoy
                pipeline.zcount(tsKey, yesterdayStart, `(${todayStart}`); // ayer
                pipeline.zcount(tsKey, mondayStart, '+inf');            // esta semana
                pipeline.zcount(tsKey, monthStart, '+inf');             // este mes
            });
            const results = await pipeline.exec();

            const counters = {};
            counterNodeIds.forEach((nodeId, i) => {
                const base = i * 5;
                counters[nodeId] = {
                    total: results[base]?.[1] || 0,
                    hoy: results[base + 1]?.[1] || 0,
                    ayer: results[base + 2]?.[1] || 0,
                    estaSemana: results[base + 3]?.[1] || 0,
                    esteMes: results[base + 4]?.[1] || 0,
                };
            });

            return res.status(200).json({ success: true, counters });
        }

        // Rango personalizado "desde/hasta" para UN nodo contador (inclusive ambos extremos).
        if (method === 'GET' && id && mode === 'counter_range') {
            const nodeId = String(req.query.nodeId || '').trim();
            const from = String(req.query.from || '').trim(); // YYYY-MM-DD (Monterrey)
            const to = String(req.query.to || '').trim();     // YYYY-MM-DD (Monterrey)
            if (!nodeId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
                return res.status(400).json({ success: false, error: 'Parámetros inválidos (nodeId, from, to)' });
            }
            const fromMs = mtyDateStartMs(from);
            const toMsExclusive = mtyDateStartMs(to) + 86400000; // incluye todo el día "to"
            if (toMsExclusive <= fromMs) {
                return res.status(400).json({ success: false, error: 'El rango "hasta" debe ser igual o posterior a "desde"' });
            }
            const count = await redis.zcount(`${COUNTER_TS_PREFIX}${id}:${nodeId}`, fromMs, `(${toMsExclusive}`);
            return res.status(200).json({ success: true, count: count || 0, from, to });
        }

        if (method === 'GET' && id && mode === 'filtered_candidates') {
            const flows = await getFlows(redis);
            const flow = flows.find(f => f.id === id);
            if (!flow) return res.status(404).json({ success: false, error: 'Flow not found' });

            const profileFilter = req.query.profileFilter || 'todos';
            const tags = String(req.query.tags || '').split(',').map(t => t.trim()).filter(Boolean);
            const within24h = req.query.within24h === '1';

            const { candidates, total } = await getCandidatesForFlowList({ profileFilter, tags, within24h });
            const ids = candidates.map(c => c.id);
            const executedFlags = ids.length ? await redis.smismember(`${EXEC_SET_PREFIX}${id}`, ...ids) : [];
            const result = candidates.map((c, i) => ({ ...c, executed: executedFlags[i] === 1 }));

            return res.status(200).json({ success: true, candidates: result, total });
        }

        // Métricas del tablero de Flujos: altas por ETIQUETA en un rango de fechas.
        // Reusa exactamente la misma fuente que el copiloto (contar_altas_etiqueta):
        // buildDateKeys(hoy/ayer/semana/mes | desde-hasta) + los contadores agregados
        // stats:daily:captures:tag:* (getCapturesByAllTags). No escanea candidatos ni
        // hidrata nada — un solo pipeline de HMGET, barato para pintar en vivo.
        if (method === 'GET' && mode === 'tag_metrics') {
            const { rango, desde, hasta } = req.query;
            const { keys, label } = buildDateKeys({ rango, desde, hasta });
            const [metrics, total, untaggedVals] = await Promise.all([
                getCapturesByAllTags(keys),
                getCapturesTotal(keys),
                redis.hmget('stats:daily:captures:untagged', ...keys)
            ]);
            const untagged = (untaggedVals || []).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
            return res.status(200).json({ success: true, metrics, total, untagged, label });
        }

        if (method === 'GET' && id) {
            const flows = await getFlows(redis);
            const flow = flows.find(f => f.id === id);
            if (!flow) return res.status(404).json({ success: false, error: 'Flow not found' });
            return res.status(200).json({ success: true, flow });
        }

        if (method === 'GET') {
            const flows = await getFlows(redis);
            return res.status(200).json({ success: true, flows });
        }

        if (method === 'POST' && id && req.body?.action === 'test') {
            const { whatsapp } = req.body || {};
            if (!whatsapp) return res.status(400).json({ success: false, error: 'whatsapp requerido' });

            // Lee directo de Redis (no cacheado) para probar exactamente contra la
            // última versión guardada del flujo, sin esperar el TTL del caché.
            const raw = await redis.get(REDIS_KEY);
            const flows = raw ? JSON.parse(raw) : [];
            const flow = flows.find(f => f.id === id);
            if (!flow) return res.status(404).json({ success: false, error: 'Flow not found' });

            const candidate = await getCandidateByPhone(whatsapp);
            if (!candidate) return res.status(404).json({ success: false, error: 'No se encontró un candidato con ese número' });

            const passed = await runFlowTest(flow, candidate);

            return res.status(200).json({
                success: true,
                candidate: { id: candidate.id, nombre: candidate.nombreReal || candidate.nombre || candidate.whatsapp },
                passed
            });
        }

        if (method === 'POST' && id && req.body?.action === 'run_list_item') {
            const { candidateId } = req.body || {};
            if (!candidateId) return res.status(400).json({ success: false, error: 'candidateId requerido' });

            const raw = await redis.get(REDIS_KEY);
            const flows = raw ? JSON.parse(raw) : [];
            const flow = flows.find(f => f.id === id);
            if (!flow) return res.status(404).json({ success: false, error: 'Flow not found' });

            const candidate = await getCandidateById(candidateId);
            if (!candidate) return res.status(404).json({ success: false, error: 'Candidato no encontrado' });

            const result = await runFlowForListCandidate(flow, candidate);
            return res.status(200).json({ success: true, alreadyExecuted: result.alreadyExecuted });
        }

        if (method === 'POST') {
            const { name, rootType } = req.body || {};
            if (!name || !String(name).trim()) {
                return res.status(400).json({ success: false, error: 'Nombre requerido' });
            }

            const flows = await getFlows(redis);
            const newFlow = {
                id: `flow_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                name: String(name).trim(),
                active: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...(rootType === 'lista' ? defaultFlowNodesLista()
                    : rootType === 'incompletos' ? defaultFlowNodesIncompletos()
                    : defaultFlowNodes())
            };

            flows.push(newFlow);
            await saveFlows(redis, flows);

            return res.status(201).json({ success: true, flow: newFlow });
        }

        if (method === 'PUT') {
            if (!id) return res.status(400).json({ success: false, error: 'Flow ID required' });

            const { name, active, nodes, edges } = req.body || {};
            const flows = await getFlows(redis);
            const flowIndex = flows.findIndex(f => f.id === id);
            if (flowIndex === -1) return res.status(404).json({ success: false, error: 'Flow not found' });

            const prevFlow = flows[flowIndex];
            // Al ACTIVAR (inactivo → activo), se marca el instante de arranque. El cron de
            // incompletos (flow-incompletos.js) solo dispara a candidatos que le escribieron
            // a Brenda DESPUÉS de este momento — así nunca se blastea el histórico completo y
            // se garantiza que todos estén dentro de la ventana de 24h de Meta (su último
            // mensaje es posterior a la activación, o sea reciente). Cada reactivación resetea
            // el punto de partida.
            const becomingActive = active !== undefined && !!active && !prevFlow.active;

            flows[flowIndex] = {
                ...prevFlow,
                ...(name !== undefined && { name: String(name).trim() || prevFlow.name }),
                ...(active !== undefined && { active: !!active }),
                ...(becomingActive && { activatedAt: new Date().toISOString() }),
                ...(Array.isArray(nodes) && { nodes }),
                ...(Array.isArray(edges) && { edges }),
                updatedAt: new Date().toISOString()
            };

            await saveFlows(redis, flows);

            // Al ACTIVAR: arranca campaña limpia. Se borran contador de pases y últimos
            // disparos del nodo de incompletos, para que el nuevo "punto de partida" sea
            // real — un candidato que reingrese tras esta activación vuelve a ser elegible
            // (no queda bloqueado por un pase de la campaña anterior). Inofensivo para
            // flujos que no son de este tipo (las llaves no existen).
            if (becomingActive) {
                redis.del(`flow:silence:count:v1:${id}`, `flow:silence:lastfire:v1:${id}`).catch(() => {});
            }

            return res.status(200).json({ success: true, flow: flows[flowIndex] });
        }

        if (method === 'DELETE') {
            if (!id) return res.status(400).json({ success: false, error: 'Flow ID required' });

            const flows = await getFlows(redis);
            const flow = flows.find(f => f.id === id);
            if (!flow) return res.status(404).json({ success: false, error: 'Flow not found' });

            const remaining = flows.filter(f => f.id !== id);
            await saveFlows(redis, remaining);

            // Limpieza de keys asociadas — conocidas de antemano por flowId/nodeId, no requiere SCAN.
            const cleanupPipeline = redis.pipeline();
            cleanupPipeline.del(`${EXEC_SET_PREFIX}${id}`);
            (flow.nodes || []).filter(n => n.type === 'contador').forEach(n => {
                cleanupPipeline.del(`${COUNTER_PREFIX}${id}:${n.id}`);
                cleanupPipeline.del(`${COUNTER_TS_PREFIX}${id}:${n.id}`);
            });
            // Hashes del nodo de incompletos-en-silencio (contador de pases + último disparo por candidato)
            cleanupPipeline.del(`flow:silence:count:v1:${id}`);
            cleanupPipeline.del(`flow:silence:lastfire:v1:${id}`);
            await cleanupPipeline.exec().catch(() => {});

            return res.status(200).json({ success: true, message: 'Flow deleted' });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });

    } catch (error) {
        console.error('Flows API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
