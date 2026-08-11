import { getRedisClient, validateAdminSession, getCandidateByPhone } from './utils/storage.js';
import { getCachedConfig, invalidateCache } from './utils/cache.js';
import { runFlowTest } from './utils/flow-engine.js';

const REDIS_KEY = 'flows:v1';
const EXEC_SET_PREFIX = 'flow:executed:v1:';
const COUNTER_PREFIX = 'flow:counter:v1:';

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

            return res.status(200).json({
                success: true,
                municipios: NL_MUNICIPIOS,
                categorias,
                escolaridades: ESCOLARIDADES,
                tags
            });
        }

        if (method === 'GET' && id && mode === 'counters') {
            const flows = await getFlows(redis);
            const flow = flows.find(f => f.id === id);
            if (!flow) return res.status(404).json({ success: false, error: 'Flow not found' });

            const counterNodeIds = (flow.nodes || []).filter(n => n.type === 'contador').map(n => n.id);
            if (!counterNodeIds.length) return res.status(200).json({ success: true, counters: {} });

            const pipeline = redis.pipeline();
            counterNodeIds.forEach(nodeId => pipeline.scard(`${COUNTER_PREFIX}${flow.id}:${nodeId}`));
            const results = await pipeline.exec();

            const counters = {};
            counterNodeIds.forEach((nodeId, i) => {
                counters[nodeId] = results[i]?.[1] || 0;
            });

            return res.status(200).json({ success: true, counters });
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

        if (method === 'POST') {
            const { name } = req.body || {};
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
                ...defaultFlowNodes()
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

            flows[flowIndex] = {
                ...flows[flowIndex],
                ...(name !== undefined && { name: String(name).trim() || flows[flowIndex].name }),
                ...(active !== undefined && { active: !!active }),
                ...(Array.isArray(nodes) && { nodes }),
                ...(Array.isArray(edges) && { edges }),
                updatedAt: new Date().toISOString()
            };

            await saveFlows(redis, flows);

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
            });
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
