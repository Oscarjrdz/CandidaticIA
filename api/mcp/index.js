/**
 * /api/mcp  —  MCP server de Candidatic para Grok (xAI)
 *
 * Endpoint único (POST) que habla el protocolo Model Context Protocol en modo
 * Streamable HTTP *stateless*: cada POST JSON-RPC se contesta con un solo
 * `application/json` (sin SSE, sin sesiones). Grok se conecta a esta URL desde
 * grok.com/connectors (Custom) o vía Remote MCP Tools de la API de xAI.
 *
 * Spec seguida:
 *   - Transporte Streamable HTTP: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 *   - Tools:                      https://modelcontextprotocol.io/specification/2025-06-18/server/tools
 *   - xAI remote MCP:             https://docs.x.ai/developers/tools/remote-mcp
 *
 * Seguridad:
 *   - Auth: header `Authorization: Bearer <token>` comparado contra `mcp:token` en Redis
 *     (se genera/rota desde Configuración → WhatsApp). Sin token válido → 401.
 *   - Kill switch: `mcp:enabled` en Redis. Si no está encendido → se rechaza todo.
 *
 * Tools: lectura + escritura de Chat Web, analítica, CRM Manual (Proyectos), la
 * sección completa de Flujos (ver/crear/editar/borrar flujos y nodos + métricas y
 * ejecución) y la sección de Estadísticas de Anuncios (ver métricas, archivar/restaurar
 * anuncios, etiquetas de anuncio y comentarios de Facebook). Las de escritura llaman a
 * los endpoints reales vía callInternal.
 * Plan y lista completa de tools: docs/mcp-grok-plan.md
 */

import { randomBytes } from 'crypto';
import {
    getRedisClient,
    getCandidates,
    getCandidateById,
    getMessages,
    getExpediente,
    getUsers
} from '../utils/storage.js';
import { substituteVariables, substituteDynamicPhrase } from '../utils/shortcuts.js';
import { getFilterCountsWithIndex, countSegment, resolveSegmentIds } from '../utils/facet-index.js';
import { getCtrBlocksCached, markRetornoAttendedByGrok, getGrokAttendedTodayCount } from '../utils/ctr-stats.js';
import { CHECKPOINT_PREFIX } from '../utils/flow-engine.js';
// Datos de transporte ESTÁTICOS (mismos que pinta la sección Mapa): estaciones del Metro de
// Monterrey por línea y paradas del corredor Ecovía. No viven en Redis, son datos embebidos.
import { METRO_LINES } from '../../src/data/metroLines.js';
import { ECOVIA_STOPS } from '../../src/data/ecoviaStops.js';

// `name` = identificador estable de la implementación (no cambiar, varios clientes
// lo usan como id). `title` = nombre legible para humanos que la UI del conector
// muestra (Candidatic, con C mayúscula). `icons` = logo que la UI pinta en vez del
// avatar genérico "C"; apunta al PNG cuadrado público (512×512) servido por Vercel.
const SERVER_INFO = {
    name: 'candidatic-chatweb',
    title: 'Candidatic',
    version: '1.0.0',
    icons: [
        { src: 'https://www.candidatic.com/favicon-candidatic.png', mimeType: 'image/png', sizes: '512x512' }
    ]
};
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const PREFERRED_PROTOCOL_VERSION = '2025-06-18';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de auth / kill switch
// ─────────────────────────────────────────────────────────────────────────────
function extractBearer(req) {
    const h = req.headers?.authorization || req.headers?.Authorization || '';
    return String(h).replace(/^Bearer\s+/i, '').trim();
}

// Comparación de strings en tiempo (razonablemente) constante para no filtrar el
// token por timing. No usamos crypto.timingSafeEqual porque los largos difieren.
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function isEnabled(redis) {
    const v = await redis.get('mcp:enabled');
    return v === '1' || v === 'true';
}

// Log de diagnóstico (fire-and-forget): lista Redis capada a 50, TTL 24h.
// Sirve para saber si las peticiones de Grok LLEGAN a la función (si el log
// queda vacío cuando Grok da 403 → el 403 es de la plataforma/firewall, no nuestro).
function logMcp(redis, req, info) {
    try {
        const ua = String(req.headers?.['user-agent'] || '').slice(0, 120);
        const ip = String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || '').split(',')[0].trim();
        const entry = JSON.stringify({ t: new Date().toISOString(), ip, ua, ...info });
        redis.pipeline()
            .lpush('mcp:log', entry)
            .ltrim('mcp:log', 0, 49)
            .expire('mcp:log', 86400)
            .exec()
            .catch(() => {});
    } catch { /* nunca romper la request por el log */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Escritura: las tools de escritura NO reimplementan la lógica del Chat Web.
// Llaman internamente a los endpoints ya probados (/api/chat, /api/candidates/*)
// usando una sesión de reclutador de SISTEMA, efímera (token aleatorio, TTL 120s),
// que es lo que esos endpoints esperan (validateAdminSession).
// ─────────────────────────────────────────────────────────────────────────────
// La sesión de sistema se identifica como un SuperAdmin real para heredar permisos
// completos (crear/eliminar proyectos y pasos lo exige el RBAC). Se cachea en memoria.
let _sysUserIdCache = null;
async function getSystemUserId() {
    if (_sysUserIdCache) return _sysUserIdCache;
    try {
        const users = await getUsers();
        const su = (users || []).find(u => u.role === 'SuperAdmin');
        _sysUserIdCache = su?.id || su?.whatsapp || 'mcp-grok';
    } catch { _sysUserIdCache = 'mcp-grok'; }
    return _sysUserIdCache;
}

// Loader de proyectos para el índice facetado (mismo que candidates.js/system/stats.js),
// para que si mi lectura dispara un rebuild, el caché compartido quede consistente.
async function loadManualProjectData(redis) {
    const projectsRaw = await redis.get('candidatic_manual_projects').catch(() => null);
    const projects = projectsRaw ? JSON.parse(projectsRaw) : [];
    const projectLinks = {};
    await Promise.all((Array.isArray(projects) ? projects : []).map(async (project) => {
        if (!project?.id) return;
        const linksRaw = await redis.get(`crm_links:${project.id}`).catch(() => null);
        try { projectLinks[project.id] = linksRaw ? JSON.parse(linksRaw) : []; } catch { projectLinks[project.id] = []; }
    }));
    return { manualProjects: Array.isArray(projects) ? projects : [], projectLinks };
}

async function callInternal(req, redis, path, method, body) {
    const token = `mcpsys_${randomBytes(24).toString('hex')}`;
    const sessionKey = `session:admin:${token}`;
    const expiresAt = new Date(Date.now() + 120000).toISOString();
    const sysUserId = await getSystemUserId();
    await redis.set(sessionKey, JSON.stringify({ userId: sysUserId, userName: 'Grok (IA)', expiresAt }), 'EX', 120);

    try {
        const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const host = req.headers.host;
        const url = `${proto}://${host}${path}`;
        const resp = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        let data = null;
        try { data = await resp.json(); } catch { /* respuesta sin cuerpo JSON */ }
        return { ok: resp.ok, status: resp.status, data };
    } finally {
        redis.del(sessionKey).catch(() => {}); // limpieza (el TTL es el respaldo)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de forma de datos (resumen compacto, sin volcar blobs enormes)
// ─────────────────────────────────────────────────────────────────────────────
function isUnread(c) {
    const u = c?.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;
    const h = c?.lastHumanMessageAt ? new Date(c.lastHumanMessageAt).getTime() : 0;
    return u > 0 && u > h;
}

function summarizeChat(c) {
    return {
        candidateId: c.id,
        nombre: (c.nombreReal && c.nombreReal.trim()) || c.nombre || 'Sin nombre',
        telefono: c.whatsapp || null,
        etiquetas: Array.isArray(c.tags) ? c.tags : [],
        vacanteActual: c.vacanteActual || null,
        perfilCompleto: c.paso2Estado === 'completo',
        noLeido: isUnread(c),
        ultimaActividad: c.lastUserMessageAt || c.updatedAt || c.createdAt || null
    };
}

function toTagNames(savedTags) {
    if (!Array.isArray(savedTags)) return [];
    return savedTags.map(t => (typeof t === 'object' && t ? (t.name || t.label || '') : String(t))).filter(Boolean);
}

// ── Paginación + proyección de campos (para listas grandes; el agente decide) ──
const ABS_MAX_PAGE = 500;    // tope duro por página (protege el presupuesto de tokens)
const ABS_MAX_TODOS = 3000;  // tope duro cuando se pide "todos"

function pageArgs(args) {
    const todos = args?.todos === true;
    let limit = parseInt(args?.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, ABS_MAX_PAGE);
    const offset = Math.max(parseInt(args?.offset, 10) || 0, 0);
    return { todos, limit, offset };
}

function pickFields(obj, campos) {
    if (!Array.isArray(campos) || !campos.length) return obj;
    const out = {};
    for (const k of campos) if (k in obj) out[k] = obj[k];
    return out;
}

// Distancia en metros entre dos puntos (lat/lng en grados). Haversine simple — sirve
// para "cruzar" pines por cercanía (ej. candidatos cerca de un pin propio/cliente).
function distanciaMetrosEntre(lat1, lng1, lat2, lng2) {
    const R = 6371000; // radio terrestre en metros
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Trae candidatos vía getCandidates con paginación o 'todos' (tope ABS_MAX_TODOS).
async function fetchCandidatesPaged({ todos, limit, offset, search = '', tag = '' }) {
    if (!todos) {
        const { candidates, total } = await getCandidates(limit, offset, search, false, tag);
        return { candidates: candidates || [], total, offset, hayMas: offset + (candidates?.length || 0) < total };
    }
    const all = [];
    let off = 0; let total = 0; const page = 500;
    while (all.length < ABS_MAX_TODOS) {
        const { candidates, total: t } = await getCandidates(page, off, search, false, tag);
        total = t;
        if (!candidates?.length) break;
        all.push(...candidates);
        off += candidates.length;
        if (off >= total) break;
    }
    const truncado = total > all.length;
    return { candidates: all.slice(0, ABS_MAX_TODOS), total, offset: 0, hayMas: truncado, truncado };
}

// ¿El candidato está dentro de la ventana de 24h de Meta (escribió hace <24h)?
function dentroVentana24h(candidate) {
    const raw = candidate?.lastUserMessageAt || candidate?.ultimoMensajeUsuario || null;
    if (!raw) return false;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) && (Date.now() - t) < 24 * 60 * 60 * 1000;
}

// Etiqueta legible por tipo de nodo de Flujos — espejo de `label` en
// src/components/flows/nodeTypes/nodeDefs.js (lo que el reclutador ve en el canvas).
// Sirve para que el MCP le dé a Grok el MISMO nombre que ve un humano, no el `type` crudo.
// Si agregas un tipo de nodo nuevo en nodeDefs.js, agrégalo también aquí.
const NODE_TYPE_LABELS = {
    inicio: 'Inicio',
    inicio_lista: 'Inicio: Lista Filtrada',
    inicio_incompleto_silencio: 'Inicio: Incompleto sin responder',
    inicio_sin_extraccion: 'Inicio: Sin extracción',
    etiqueta: 'Filtro: Etiqueta',
    condicion_genero: 'Condición: Género',
    condicion_edad: 'Condición: Edad',
    condicion_municipio: 'Condición: Municipio',
    condicion_categoria: 'Condición: Categoría',
    condicion_escolaridad: 'Condición: Escolaridad',
    condicion_checkpoint: 'Condición: Check Point',
    accion_whatsapp: 'Mandar WhatsApp',
    accion_vacante: 'Mandar Vacante',
    accion_whatsapp_personalizado: 'WhatsApp Personalizado',
    accion_botones: 'Mandar Botones / Opciones',
    accion_ubicacion: 'Pedir Ubicación',
    frase_dinamica: 'Frase Dinámica',
    accion_etiqueta: 'Agregar Etiqueta',
    accion_quitar_etiqueta: 'Quitar Etiqueta',
    accion_limpiar_etiquetas: 'Limpiar Etiquetas',
    accion_recordatorio: 'Mandar Recordatorio',
    accion_proyecto: 'Meter a Proyecto',
    accion_marcar_leido: 'Marcar Leído',
    accion_desactivar_bot: 'Desactivar Bot',
    accion_reactivar_bot: 'Reactivar Bot',
    esperando_respuesta: 'Esperando Respuesta',
    contador: 'Contador',
    checkpoint: 'Check Point',
    test: 'Nodo Test',
    nota: 'Nota',
    bg: 'Fondo',
    texto: 'Texto'
};

// Nombre visible de un nodo, igual que lo muestra el canvas: etiqueta del tipo +
// alias personalizado (data.customName) si lo tiene. Nunca devuelve null.
function nodeDisplayName(node) {
    const tipoLabel = NODE_TYPE_LABELS[node?.type] || node?.type || 'Nodo';
    const alias = (node?.data?.customName || '').trim();
    return alias ? `${tipoLabel} — ${alias}` : tipoLabel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers del nodo "Pedir Ubicación" (accion_ubicacion)
// Espejo de los defaults del editor (FlowEditor.jsx / NodeConfigDrawer.jsx) para
// que Grok no tenga que reconstruir a mano el data.rutas[] completo. Todo lo demás
// (guardar, auth, side-effects) sigue pasando por /api/flows vía callInternal.
// ─────────────────────────────────────────────────────────────────────────────
const UBICACION_DEFAULT_BODY = '📍 ¡Mándame tu ubicación! Con el botón de abajo compárteme dónde vives y te digo si la ruta te queda cerca 😊';
const UBICACION_DEFAULT_SUCCESS_MSG = '🎉 ¡Felicidades {{nombre}}! Te queda la ruta {{ruta cercana}} en la parada #{{numero parada}} ({{parada cercana}}), a {{metros parada}} m.';

// Lee las rutas de un nodo, tolerando el formato viejo (data.paradas = una sola lista).
function getNodeRutas(node) {
    const d = node?.data || {};
    if (Array.isArray(d.rutas) && d.rutas.length) return d.rutas;
    if (Array.isArray(d.paradas) && d.paradas.length) {
        return [{ nombre: d.rutaNombre || '', paradas: d.paradas, successMessage: UBICACION_DEFAULT_SUCCESS_MSG, mediaUrl: '', mediaType: '', mediaName: '' }];
    }
    return [];
}

// Valida y normaliza UNA ruta a la forma que el motor espera. Lanza error legible si algo falla.
function normalizeRuta(ruta, i = 0) {
    if (!ruta || typeof ruta !== 'object') throw new Error(`Ruta #${i + 1} inválida (debe ser un objeto)`);
    const nombre = String(ruta.nombre || '').trim();
    if (!nombre) throw new Error(`Ruta #${i + 1}: falta "nombre"`);
    const paradasRaw = Array.isArray(ruta.paradas) ? ruta.paradas : [];
    const paradas = paradasRaw.map((p, j) => {
        const pn = String(p?.nombre || '').trim();
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        if (!pn) throw new Error(`Ruta "${nombre}", parada #${j + 1}: falta "nombre"`);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`Ruta "${nombre}", parada "${pn}": lat/lng deben ser números (grados decimales; lng negativa en México)`);
        return { nombre: pn, lat, lng };
    });
    // successMessage: si no mandan nada, se pre-carga el default (igual que el editor).
    const successMessage = (ruta.successMessage === undefined || ruta.successMessage === null)
        ? UBICACION_DEFAULT_SUCCESS_MSG
        : String(ruta.successMessage);
    const mediaUrl = String(ruta.mediaUrl || '').trim();
    const mediaType = mediaUrl ? (String(ruta.mediaType || 'image') === 'document' ? 'document' : 'image') : '';
    const mediaName = mediaUrl ? String(ruta.mediaName || '').trim() : '';
    return { nombre, paradas, successMessage, mediaUrl, mediaType, mediaName };
}

// Resumen liviano de una ruta (para listados, sin volcar todas las paradas).
function summarizeRuta(ruta) {
    return {
        nombre: String(ruta?.nombre || ''),
        numParadas: Array.isArray(ruta?.paradas) ? ruta.paradas.length : 0,
        tieneMensaje: !!String(ruta?.successMessage || '').trim(),
        media: ruta?.mediaUrl ? { tipo: ruta.mediaType || 'image', nombre: ruta.mediaName || '', url: ruta.mediaUrl } : null
    };
}

// Lee un flujo por id vía callInternal; lanza error si no existe.
async function fetchFlowOrThrow(req, redis, id) {
    const r = await callInternal(req, redis, `/api/flows?id=${encodeURIComponent(id)}`, 'GET');
    if (r.status === 404) throw new Error('Flujo no encontrado');
    if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer el flujo (${r.status})`);
    const f = r.data?.flow;
    if (!f) throw new Error('Flujo no encontrado');
    return f;
}

// Clasifica un flujo por su nodo raíz: "estandar" (en vivo, arranca con "inicio"),
// "lista" (manual sobre lista filtrada) o "incompletos" (incompletos en silencio por cron).
function classifyFlowTipo(nodes) {
    const types = new Set((Array.isArray(nodes) ? nodes : []).map(n => n?.type));
    if (types.has('inicio_incompleto_silencio')) return 'incompletos';
    if (types.has('inicio_sin_extraccion')) return 'sin_extraccion';
    if (types.has('inicio_lista')) return 'lista';
    if (types.has('inicio')) return 'estandar';
    return 'desconocido';
}

// Tipos de nodo válidos para crear_nodo (mismas llaves que NODE_TYPE_LABELS).
const VALID_NODE_TYPES = new Set(Object.keys(NODE_TYPE_LABELS));

// Guarda nodes (y opcionalmente edges) de un flujo vía callInternal (PUT /api/flows).
async function saveFlowNodes(req, redis, id, nodes, edges) {
    const body = { nodes };
    if (edges !== undefined) body.edges = edges;
    const r = await callInternal(req, redis, `/api/flows?id=${encodeURIComponent(id)}`, 'PUT', body);
    if (r.status === 404) throw new Error('Flujo no encontrado');
    if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al guardar el flujo (${r.status})`);
    return r.data?.flow;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de TOOLS
// Cada tool: { description, inputSchema, handler(args, { redis, req }) -> any }
// El valor que regrese el handler se serializa a JSON dentro de un content text.
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = {
    listar_chats: {
        description: 'Lista los chats/candidatos del Chat Web (resumen). Paginado: limit (default 50, máx 500) + offset, o todos:true para traer toda la base (tope de seguridad ~3000). Elige columnas con "campos". Respuesta: {total, offset, hayMas, chats}.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Cuántos por página (default 50, máx 500).' },
                offset: { type: 'number', description: 'Desde qué posición (default 0).' },
                todos: { type: 'boolean', description: 'true = traer todos (pagina internamente; tope ~3000).' },
                busqueda: { type: 'string', description: 'Texto para filtrar por nombre o teléfono.' },
                etiqueta: { type: 'string', description: 'Filtrar por una etiqueta exacta.' },
                soloNoLeidos: { type: 'boolean', description: 'Si es true, solo chats con mensajes no leídos.' },
                campos: { type: 'array', items: { type: 'string' }, description: 'Qué campos devolver (ej. ["candidateId","nombre","telefono"]). Vacío = todos.' }
            }
        },
        handler: async (args) => {
            const { todos, limit, offset } = pageArgs(args);
            const res = await fetchCandidatesPaged({ todos, limit, offset, search: String(args?.busqueda || ''), tag: String(args?.etiqueta || '') });
            let chats = res.candidates.map(summarizeChat);
            if (args?.soloNoLeidos) chats = chats.filter(c => c.noLeido);
            return {
                total: res.total, offset: res.offset, mostrados: chats.length, hayMas: res.hayMas,
                ...(res.truncado ? { truncado: true } : {}),
                chats: chats.map(c => pickFields(c, args?.campos))
            };
        }
    },

    leer_chat: {
        description: 'Lee el historial de mensajes de un chat. limit (default 50, máx 500) = cuántos mensajes recientes; offset = saltar N desde el final (para ir más atrás en el historial). Respuesta: {total, offset, hayMas, mensajes}.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato (de listar_chats o buscar_candidato).' },
                limit: { type: 'number', description: 'Cuántos mensajes recientes (default 50, máx 500).' },
                offset: { type: 'number', description: 'Saltar N mensajes desde el más reciente (default 0).' }
            },
            required: ['candidateId']
        },
        handler: async (args) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            let limit = parseInt(args?.limit, 10);
            if (!Number.isFinite(limit) || limit <= 0) limit = 50;
            limit = Math.min(limit, ABS_MAX_PAGE);
            const offset = Math.max(parseInt(args?.offset, 10) || 0, 0);

            // getMessages regresa los más recientes en orden cronológico (viejo→nuevo).
            // Traemos una ventana de offset+limit y tomamos el tramo pedido desde el final.
            const window = await getMessages(id, Math.min(offset + limit, 1000));
            const totalVentana = window.length;
            const endExclusive = Math.max(totalVentana - offset, 0);
            const startInclusive = Math.max(endExclusive - limit, 0);
            const slice = window.slice(startInclusive, endExclusive);
            return {
                offset,
                mostrados: slice.length,
                hayMas: startInclusive > 0,
                mensajes: slice.map(m => ({
                    de: m.from === 'me' ? 'reclutador' : (m.from === 'bot' ? 'brenda' : 'candidato'),
                    texto: m.content || '',
                    tipo: m.type || 'text',
                    fecha: m.timestamp || m.fecha || null,
                    estado: m.status || null
                }))
            };
        }
    },

    buscar_candidato: {
        description: 'Busca candidatos por nombre o teléfono. Paginado: limit (default 50, máx 500) + offset, o todos:true. Elige columnas con "campos". Devuelve candidateId para luego leer o actuar.',
        inputSchema: {
            type: 'object',
            properties: {
                texto: { type: 'string', description: 'Nombre o teléfono a buscar.' },
                limit: { type: 'number', description: 'Cuántos por página (default 50, máx 500).' },
                offset: { type: 'number', description: 'Desde qué posición (default 0).' },
                todos: { type: 'boolean', description: 'true = traer todas las coincidencias (tope ~3000).' },
                campos: { type: 'array', items: { type: 'string' }, description: 'Qué campos devolver. Vacío = todos.' }
            },
            required: ['texto']
        },
        handler: async (args) => {
            const texto = String(args?.texto || '').trim();
            if (!texto) throw new Error('Falta el texto de búsqueda');
            const { todos, limit, offset } = pageArgs(args);
            const res = await fetchCandidatesPaged({ todos, limit, offset, search: texto });
            return {
                total: res.total, offset: res.offset, mostrados: res.candidates.length, hayMas: res.hayMas,
                ...(res.truncado ? { truncado: true } : {}),
                resultados: res.candidates.map(c => pickFields(summarizeChat(c), args?.campos))
            };
        }
    },

    ver_perfil_candidato: {
        description: 'Devuelve el perfil/datos de un candidato: nombre, edad, municipio, colonia, escolaridad, categoría, experiencia y vacante actual.',
        inputSchema: {
            type: 'object',
            properties: { candidateId: { type: 'string', description: 'ID del candidato.' } },
            required: ['candidateId']
        },
        handler: async (args) => {
            const c = await getCandidateById(String(args?.candidateId || '').trim());
            if (!c) throw new Error('Candidato no encontrado');
            return {
                candidateId: c.id,
                nombre: c.nombreReal || c.nombre || null,
                nombreWhatsApp: c.nombre || null,
                telefono: c.whatsapp || null,
                edad: c.edad || null,
                fechaNacimiento: c.fechaNacimiento || null,
                municipio: c.municipio || null,
                colonia: c.colonia || null,
                escolaridad: c.escolaridad || null,
                categoria: c.categoria || null,
                experiencia: c.experiencia || null,
                mesesExperiencia: c.mesesExperiencia || null,
                vacanteActual: c.vacanteActual || null,
                etiquetas: Array.isArray(c.tags) ? c.tags : [],
                perfilCompleto: c.paso2Estado === 'completo',
                // Asistencia = el candidato SÍ llegó a su cita (mismo dato que el punto azul
                // de la sección Candidatos y el botón "asistencia" del Chat Web). Márcala/quítala
                // con marcar_asistencia.
                asistencia: c.asistencia === true,
                asistenciaAt: c.asistencia === true ? (c.asistenciaAt || null) : null,
                creado: c.createdAt || null
            };
        }
    },

    ver_ctr: {
        description: 'CTR de completos del dashboard (datos REALES, sin tope de 100). Dos bloques: "hoy" = candidatos cuyo PRIMER CONTACTO es hoy (00:00 → ahora, zona Monterrey); "ultimos100" = los 100 candidatos más recientes. Por bloque devuelve total, completos, incompletos, pct y el desglose de "atorados" por paso de captura (nombre, nacimiento, municipio, escolaridad, categoría, colonia, experiencia, meses). Además devuelve "retornadosCompletosHoy": candidatos con perfil COMPLETO que YA existían (primer contacto en un día anterior) y volvieron a escribir HOY — señal de actividad de Sala de Espera, disjunto de los completos nuevos de hoy. Ese bloque trae "atendidosPorGrok" (cuántos de esos retornados ya marcaste como atendidos hoy con la tool marcar_retorno_atendido) y "pendientesPorAtender". Para cada número incluye la COMPOSICIÓN: los candidatos (id + nombre) que lo forman, con tope por grupo. Usa candidateId luego en ver_perfil_candidato / leer_chat, y marcar_retorno_atendido cuando ya le diste seguimiento a un retornado.',
        inputSchema: {
            type: 'object',
            properties: {
                bloque: { type: 'string', description: 'Opcional: "hoy" o "ultimos100" para traer solo uno. Vacío = ambos.' },
                incluirCandidatos: { type: 'boolean', description: 'Incluir la lista de candidatos que compone cada número (default true).' },
                maxPorGrupo: { type: 'number', description: 'Máximo de candidatos a listar por grupo/paso (default 25, máx 200). El resto se resume en "yMas".' }
            }
        },
        handler: async (args) => {
            const data = await getCtrBlocksCached();
            if (!data) throw new Error('CTR no disponible (Redis sin conexión)');
            // Cuántos de los completos-que-volvieron atendió Grok HOY (fresco, SCARD del set del día).
            const atendidosPorGrok = await getGrokAttendedTodayCount();

            const incluir = args?.incluirCandidatos !== false;
            let cap = parseInt(args?.maxPorGrupo, 10);
            if (!Number.isFinite(cap) || cap <= 0) cap = 25;
            cap = Math.min(cap, 200);

            const takeRefs = (refs, count) => {
                const shown = (refs || []).slice(0, cap);
                const yMas = count - shown.length;
                return { candidatos: shown, ...(yMas > 0 ? { yMas } : {}) };
            };
            const fmtBlock = (b) => {
                if (!b) return null;
                const out = {
                    total: b.total,
                    completos: b.completos,
                    incompletos: b.total - b.completos,
                    pct: b.pct,
                    atorados: (b.stuck || []).map(s => ({
                        paso: s.label,
                        clave: s.key,
                        cantidad: s.count,
                        ...(incluir ? takeRefs(s.refs, s.count) : {})
                    }))
                };
                if (incluir) {
                    const comp = takeRefs(b.completosRefs, b.completos);
                    out.candidatosCompletos = comp.candidatos;
                    if (comp.yMas) out.completosYMas = comp.yMas;
                }
                return out;
            };

            const fmtRetornos = (r) => {
                if (!r) return { total: 0, atendidosPorGrok };
                const out = { total: r.total, atendidosPorGrok, pendientesPorAtender: Math.max(0, r.total - atendidosPorGrok) };
                if (incluir) {
                    const comp = takeRefs(r.refs, r.total);
                    out.candidatos = comp.candidatos;
                    if (comp.yMas) out.yMas = comp.yMas;
                }
                return out;
            };

            const which = String(args?.bloque || '').toLowerCase().replace(/[_\s]/g, '');
            const result = { fecha: data.fecha, generado: new Date(data.asOf).toISOString() };
            if (which === 'hoy') {
                result.hoy = fmtBlock(data.today);
                result.retornadosCompletosHoy = fmtRetornos(data.retornosHoy);
            } else if (which === 'ultimos100' || which === 'ultimos') {
                result.ultimos100 = fmtBlock(data.ultimos100);
            } else {
                result.hoy = fmtBlock(data.today);
                result.ultimos100 = fmtBlock(data.ultimos100);
                result.retornadosCompletosHoy = fmtRetornos(data.retornosHoy);
            }
            return result;
        }
    },

    marcar_retorno_atendido: {
        description: 'Marca a un candidato de "completos que volvieron hoy" (bloque retornadosCompletosHoy de ver_ctr) como ATENDIDO por ti (Grok). Úsalo cuando YA conversaste o diste seguimiento a ese completo que regresó a escribir hoy. Idempotente: marcar dos veces al mismo no lo cuenta doble. El contador se reinicia cada día (zona Monterrey) y se refleja en el dashboard como "(N atendidos por Grok)" junto a "completos volvieron hoy". Devuelve el total de atendidos hoy.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato (el "id" que te dio ver_ctr en retornadosCompletosHoy.candidatos).' }
            },
            required: ['candidateId']
        },
        handler: async (args) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const atendidosPorGrokHoy = await markRetornoAttendedByGrok(id);
            return { ok: true, candidateId: id, atendidosPorGrokHoy };
        }
    },

    listar_banco_respuestas: {
        description: 'Lista las respuestas del banco de respuestas disponibles (nombre, atajo, un preview del texto y si trae media). Úsalo para saber qué respuestas predefinidas puedes mandar.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis }) => {
            const raw = await redis.get('candidatic:quick_replies');
            const replies = raw ? JSON.parse(raw) : [];
            return (Array.isArray(replies) ? replies : []).map(r => ({
                id: r.id,
                nombre: r.name || '',
                atajo: r.shortcut || '',
                preview: String(r.message || '').slice(0, 140),
                tipo: r.type || 'text',
                tieneMedia: !!(r.imageUrl || r.imageUrl2 || r.imageUrl3 || r.imageUrl4 || r.audioUrl || r.documentUrl),
                tieneFraseDinamica: !!r.dynamicPhrase
            }));
        }
    },

    listar_etiquetas: {
        description: 'Lista todas las etiquetas disponibles en el Chat Web.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis }) => {
            const raw = await redis.get('candidatic:chat_tags');
            const saved = raw ? JSON.parse(raw) : [];
            return { etiquetas: toTagNames(saved) };
        }
    },

    ver_etiquetas_candidato: {
        description: 'Devuelve las etiquetas puestas a un candidato específico.',
        inputSchema: {
            type: 'object',
            properties: { candidateId: { type: 'string', description: 'ID del candidato.' } },
            required: ['candidateId']
        },
        handler: async (args) => {
            const c = await getCandidateById(String(args?.candidateId || '').trim());
            if (!c) throw new Error('Candidato no encontrado');
            return { candidateId: c.id, etiquetas: Array.isArray(c.tags) ? c.tags : [] };
        }
    },

    ver_estado_bot: {
        description: 'Indica si el bot (Brenda, la IA) está activo o silenciado en el chat de un candidato. Silenciado = un humano tomó el control.',
        inputSchema: {
            type: 'object',
            properties: { candidateId: { type: 'string', description: 'ID del candidato.' } },
            required: ['candidateId']
        },
        handler: async (args) => {
            const c = await getCandidateById(String(args?.candidateId || '').trim());
            if (!c) throw new Error('Candidato no encontrado');
            const silenciado = c.blocked === true;
            return {
                candidateId: c.id,
                botActivo: !silenciado,
                silenciadoHasta: silenciado ? (c.blockedExpiresAt || null) : null
            };
        }
    },

    ver_estado_crm: {
        description: 'Devuelve el estado del candidato en el CRM (columna/etapa/status) y su vacante actual.',
        inputSchema: {
            type: 'object',
            properties: { candidateId: { type: 'string', description: 'ID del candidato.' } },
            required: ['candidateId']
        },
        handler: async (args) => {
            const c = await getCandidateById(String(args?.candidateId || '').trim());
            if (!c) throw new Error('Candidato no encontrado');
            return {
                candidateId: c.id,
                columna: c.columna || null,
                status: c.status || null,
                etapa: c.etapa || null,
                vacanteActual: c.vacanteActual || null
            };
        }
    },

    ver_recordatorios: {
        description: 'Lista los recordatorios (campanita) programados de un candidato.',
        inputSchema: {
            type: 'object',
            properties: { candidateId: { type: 'string', description: 'ID del candidato.' } },
            required: ['candidateId']
        },
        handler: async (args, { redis }) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const ids = await redis.smembers(`direct_reminders:candidate:${id}`);
            if (!ids.length) return { recordatorios: [] };
            const pipe = redis.pipeline();
            ids.forEach(rid => pipe.get(`direct_reminder:${rid}`));
            const results = await pipe.exec();
            const recordatorios = results
                .map(([, raw]) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } })
                .filter(Boolean)
                .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
                .map(r => ({ id: r.id, para: r.scheduledAt, mensaje: r.message || r.templateName || null }));
            return { recordatorios };
        }
    },

    ver_expediente: {
        description: 'Lista los archivos guardados en el expediente digital de un candidato (fotos, PDFs, audios).',
        inputSchema: {
            type: 'object',
            properties: { candidateId: { type: 'string', description: 'ID del candidato.' } },
            required: ['candidateId']
        },
        handler: async (args) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const entries = await getExpediente(id);
            return {
                archivos: (entries || []).map(e => ({
                    id: e.id,
                    tipo: e.type || 'document',
                    nombre: e.filename || 'archivo',
                    url: e.url || null,
                    fecha: e.createdAt || e.addedAt || null
                }))
            };
        }
    },

    listar_plantillas: {
        description: 'Lista las plantillas oficiales de Meta aprobadas (nombre e idioma). Úsalas con enviar_plantilla para escribirle a candidatos fuera de la ventana de 24h.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis, req }) => {
            const r = await callInternal(req, redis, '/api/whatsapp/templates', 'GET');
            const templates = Array.isArray(r.data?.data) ? r.data.data : [];
            return {
                plantillas: templates.map(t => ({
                    nombre: t.name || null,
                    idioma: t.language || null,
                    estado: t.status || null
                }))
            };
        }
    },

    listar_vacantes: {
        description: 'Lista TODAS las vacantes de la plataforma con sus datos completos: id, nombre, empresa, categoría, descripción, descripción para el mensaje al candidato y si está activa. El orden es el mismo en que Brenda las ofrece.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis, req }) => {
            const r = await callInternal(req, redis, '/api/vacancies', 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al listar vacantes (${r.status})`);
            const vacancies = Array.isArray(r.data?.data) ? r.data.data : [];
            return {
                total: vacancies.length,
                vacantes: vacancies.map(v => ({
                    id: v.id,
                    nombre: v.name || v.titulo || v.nombre || null,
                    empresa: v.company || null,
                    categoria: v.category || v.categoria || null,
                    descripcion: v.description || '',
                    descripcionMensaje: v.messageDescription || '',
                    activa: v.active !== undefined ? v.active : (v.activa !== undefined ? v.activa : null)
                }))
            };
        }
    },

    crear_vacante: {
        description: 'Crea una vacante nueva. nombre, empresa y categoria son obligatorios; descripcion y descripcionMensaje (el texto que Brenda le manda al candidato) son opcionales. La categoria debe existir (usa listar_categorias). Devuelve la vacante creada con su id.',
        inputSchema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre/puesto de la vacante.' },
                empresa: { type: 'string', description: 'Empresa.' },
                categoria: { type: 'string', description: 'Categoría (nombre). Debe existir en el catálogo.' },
                descripcion: { type: 'string', description: 'Descripción interna (opcional).' },
                descripcionMensaje: { type: 'string', description: 'Texto que Brenda envía al candidato (opcional).' }
            },
            required: ['nombre', 'empresa', 'categoria']
        },
        handler: async (args, { redis, req }) => {
            const name = String(args?.nombre || '').trim();
            const company = String(args?.empresa || '').trim();
            const category = String(args?.categoria || '').trim();
            if (!name || !company || !category) throw new Error('Faltan nombre, empresa o categoria');
            const r = await callInternal(req, redis, '/api/vacancies', 'POST', {
                name, company, category,
                description: args?.descripcion || '',
                messageDescription: args?.descripcionMensaje || ''
            });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al crear la vacante (${r.status})`);
            const v = r.data?.data || {};
            return { creada: true, id: v.id, nombre: v.name, empresa: v.company, categoria: v.category };
        }
    },

    editar_vacante: {
        description: 'Edita una vacante existente (de listar_vacantes). Manda solo los campos que quieras cambiar (nombre, empresa, categoria, descripcion, descripcionMensaje, activa). Es un merge: lo que no mandes se conserva.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'ID de la vacante.' },
                nombre: { type: 'string', description: 'Nuevo nombre (opcional).' },
                empresa: { type: 'string', description: 'Nueva empresa (opcional).' },
                categoria: { type: 'string', description: 'Nueva categoría (opcional).' },
                descripcion: { type: 'string', description: 'Nueva descripción interna (opcional).' },
                descripcionMensaje: { type: 'string', description: 'Nuevo texto para el candidato (opcional).' },
                activa: { type: 'boolean', description: 'Activar/desactivar la vacante (opcional).' }
            },
            required: ['id']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.id || '').trim();
            if (!id) throw new Error('Falta id');
            const updates = { id };
            if (args?.nombre !== undefined) updates.name = String(args.nombre).trim();
            if (args?.empresa !== undefined) updates.company = String(args.empresa).trim();
            if (args?.categoria !== undefined) updates.category = String(args.categoria).trim();
            if (args?.descripcion !== undefined) updates.description = String(args.descripcion);
            if (args?.descripcionMensaje !== undefined) updates.messageDescription = String(args.descripcionMensaje);
            if (typeof args?.activa === 'boolean') updates.active = args.activa;
            const r = await callInternal(req, redis, '/api/vacancies', 'PUT', updates);
            if (r.status === 404) throw new Error('Vacante no encontrada');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al editar la vacante (${r.status})`);
            const v = r.data?.data || {};
            return { editada: true, id, nombre: v.name, empresa: v.company, categoria: v.category, activa: v.active };
        }
    },

    borrar_vacante: {
        description: 'Borra una vacante por su id (de listar_vacantes). Acción irreversible.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'ID de la vacante a borrar.' } },
            required: ['id']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.id || '').trim();
            if (!id) throw new Error('Falta id');
            const r = await callInternal(req, redis, `/api/vacancies?id=${encodeURIComponent(id)}`, 'DELETE');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al borrar la vacante (${r.status})`);
            return { borrada: true, id };
        }
    },

    listar_categorias: {
        description: 'Lista las categorías de vacantes (id, nombre). El orden es el mismo en que Brenda las ofrece al candidato.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis, req }) => {
            const r = await callInternal(req, redis, '/api/categories', 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al listar categorías (${r.status})`);
            const cats = Array.isArray(r.data?.data) ? r.data.data : [];
            return { total: cats.length, categorias: cats.map(c => ({ id: c.id, nombre: c.name })) };
        }
    },

    crear_categoria: {
        description: 'Crea una categoría nueva de vacantes. nombre obligatorio (no puede repetirse). Devuelve la categoría creada con su id.',
        inputSchema: {
            type: 'object',
            properties: { nombre: { type: 'string', description: 'Nombre de la categoría.' } },
            required: ['nombre']
        },
        handler: async (args, { redis, req }) => {
            const name = String(args?.nombre || '').trim();
            if (!name) throw new Error('Falta el nombre de la categoría');
            const r = await callInternal(req, redis, '/api/categories', 'POST', { name });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al crear la categoría (${r.status})`);
            const c = r.data?.data || {};
            return { creada: true, id: c.id, nombre: c.name };
        }
    },

    editar_categoria: {
        description: 'Renombra una categoría de vacantes existente (de listar_categorias). OJO: solo cambia el nombre en el catálogo; las vacantes que ya apuntaban al nombre viejo no se re-vinculan solas.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'ID de la categoría.' },
                nombre: { type: 'string', description: 'Nuevo nombre.' }
            },
            required: ['id', 'nombre']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.id || '').trim();
            const name = String(args?.nombre || '').trim();
            if (!id) throw new Error('Falta id');
            if (!name) throw new Error('Falta el nombre');
            const r = await callInternal(req, redis, '/api/categories', 'PUT', { id, name });
            if (r.status === 404) throw new Error('Categoría no encontrada');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al editar la categoría (${r.status})`);
            const c = r.data?.data || {};
            return { editada: true, id: c.id, nombre: c.name };
        }
    },

    borrar_categoria: {
        description: 'Borra una categoría de vacantes por su id (de listar_categorias). No borra las vacantes de esa categoría; solo la quita del catálogo.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'ID de la categoría a borrar.' } },
            required: ['id']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.id || '').trim();
            if (!id) throw new Error('Falta id');
            const r = await callInternal(req, redis, `/api/categories?id=${encodeURIComponent(id)}`, 'DELETE');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al borrar la categoría (${r.status})`);
            return { borrada: true, id };
        }
    },

    ver_presencia: {
        description: 'Indica si algún reclutador humano está atendiendo en este momento el chat de un candidato (lock de presencia).',
        inputSchema: {
            type: 'object',
            properties: { candidateId: { type: 'string', description: 'ID del candidato.' } },
            required: ['candidateId']
        },
        handler: async (args, { redis }) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const raw = await redis.get(`chat_lock:${id}`);
            if (!raw) return { atendiendo: false };
            try {
                const lock = JSON.parse(raw);
                return { atendiendo: true, reclutador: lock.user || null, desde: lock.lockedAt || null };
            } catch {
                return { atendiendo: false };
            }
        }
    },

    // ───────────────────── ANALÍTICA DE LA BASE COMPLETA ─────────────────────

    estadisticas_base: {
        description: 'Panorama agregado de TODA la base de candidatos: total y distribuciones por género, estatus (completo/incompleto), escolaridad, municipio, colonia y edad. Instantáneo (índice facetado). Úsalo para responder "cuántos tenemos", "distribución por X", etc.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis }) => {
            const counts = await getFilterCountsWithIndex(redis, () => loadManualProjectData(redis));
            const top = (obj, n) => Object.entries(obj || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, n)
                .map(([valor, total]) => ({ valor, total }));
            return {
                total: counts.total || 0,
                porGenero: top(counts.genders, 10),
                porEstatus: top(counts.estatus, 5),
                porEscolaridad: top(counts.escolaridades, 10),
                porMunicipio: top(counts.municipalities, 25),
                porColonia: top(counts.colonias, 30),
                porEdad: Object.entries(counts.ages || {})
                    .map(([edad, total]) => ({ edad, total }))
                    .sort((a, b) => Number(a.edad) - Number(b.edad))
            };
        }
    },

    filtrar_base: {
        description: 'Cruza/filtra TODA la base por varias dimensiones a la vez y devuelve el conteo exacto + una muestra de candidatos. Ej: mujeres de Monterrey con secundaria. Usa los valores EXACTOS que ves en estadisticas_base (género "Hombre"/"Mujer", escolaridad "Secundaria", etc.; "Sin dato" para faltantes).',
        inputSchema: {
            type: 'object',
            properties: {
                genero: { type: 'string', description: 'Hombre | Mujer | Sin dato' },
                municipio: { type: 'string', description: 'Nombre de municipio (puede ser varios separados por coma).' },
                colonia: { type: 'string', description: 'Nombre de colonia (puede ser varias separadas por coma).' },
                escolaridad: { type: 'string', description: 'Primaria | Secundaria | Preparatoria | Técnica | Licenciatura | Posgrado | Sin dato' },
                estatus: { type: 'string', enum: ['completo', 'incompleto'], description: 'Perfil completo o incompleto.' },
                etiqueta: { type: 'string', description: 'Una etiqueta exacta (o varias separadas por coma).' },
                edadMin: { type: 'number', description: 'Edad mínima.' },
                edadMax: { type: 'number', description: 'Edad máxima.' },
                soloVentana24h: { type: 'boolean', description: 'Solo quienes escribieron en las últimas 24h (se les puede mandar texto libre).' },
                muestra: { type: 'number', description: 'Cuántos candidatos devolver (default 15, máx 500; con todos:true hasta ~3000). 0 = solo el conteo.' },
                offset: { type: 'number', description: 'Desde qué posición de la muestra (default 0).' },
                todos: { type: 'boolean', description: 'true = traer todos los que caen en el filtro (tope ~3000).' },
                campos: { type: 'array', items: { type: 'string' }, description: 'Qué campos devolver por candidato. Vacío = todos.' }
            }
        },
        handler: async (args, { redis }) => {
            const multi = (v) => v == null ? [] : String(v).split(',').map(s => s.trim()).filter(Boolean);
            const selection = {
                genero: multi(args?.genero),
                municipio: multi(args?.municipio),
                colonia: multi(args?.colonia),
                escolaridad: multi(args?.escolaridad),
                tags: multi(args?.etiqueta)
            };
            if (args?.estatus === 'completo' || args?.estatus === 'incompleto') selection.estatus = args.estatus;
            if (args?.soloVentana24h === true) selection.ventana24h = 'si';
            if (args?.edadMin != null || args?.edadMax != null) {
                selection.edadRange = { min: args?.edadMin ?? '', max: args?.edadMax ?? '' };
            }

            const total = await countSegment(redis, selection);

            const todos = args?.todos === true;
            const offset = Math.max(parseInt(args?.offset, 10) || 0, 0);
            let sampleN = parseInt(args?.muestra, 10);
            if (!Number.isFinite(sampleN)) sampleN = todos ? ABS_MAX_TODOS : 15;
            sampleN = Math.min(Math.max(sampleN, 0), todos ? ABS_MAX_TODOS : ABS_MAX_PAGE);

            let muestra = [];
            if (sampleN > 0 && total > 0) {
                let ids = await resolveSegmentIds(redis, selection, [], offset + sampleN);
                ids = ids.slice(offset, offset + sampleN);
                if (ids.length) {
                    const pipe = redis.pipeline();
                    ids.forEach(id => pipe.get(`candidate:${id}`));
                    const rows = await pipe.exec();
                    muestra = (rows || []).map(([e, raw]) => {
                        if (e || !raw) return null;
                        try {
                            const c = JSON.parse(raw);
                            return pickFields({
                                candidateId: c.id,
                                nombre: (c.nombreReal && c.nombreReal.trim()) || c.nombre || 'Sin nombre',
                                telefono: c.whatsapp || null,
                                edad: c.edad || null,
                                genero: c.genero || null,
                                municipio: c.municipio || null,
                                colonia: c.colonia || null,
                                escolaridad: c.escolaridad || null,
                                categoria: c.categoria || null,
                                vacanteActual: c.vacanteActual || null
                            }, args?.campos);
                        } catch { return null; }
                    }).filter(Boolean);
                }
            }
            return { total, offset, mostrados: muestra.length, hayMas: offset + muestra.length < total, muestra };
        }
    },

    estadisticas_por_hora: {
        description: 'Distribución por hora del día y día de la semana. tipo="nuevos" (default) = candidatos CREADOS (hora de registro, del id/createdAt); tipo="mensajes" = mensajes ENTRANTES del candidato (más pesado; conviene acotar con etiqueta). Opcional: desde/hasta (ISO), etiqueta, zonaHoraria (default America/Monterrey). Responde {rango, total, porHora, porDiaSemana, horaPico, diaPico}.',
        inputSchema: {
            type: 'object',
            properties: {
                tipo: { type: 'string', enum: ['nuevos', 'mensajes'], description: 'nuevos (registros, default) o mensajes (entrantes).' },
                desde: { type: 'string', description: 'Fecha-hora ISO de inicio (opcional; sin ella = toda la base).' },
                hasta: { type: 'string', description: 'Fecha-hora ISO de fin (opcional).' },
                etiqueta: { type: 'string', description: 'Acota a candidatos con esta etiqueta (recomendado para tipo=mensajes).' },
                zonaHoraria: { type: 'string', description: 'Zona horaria IANA (default America/Monterrey).' }
            }
        },
        handler: async (args, { redis }) => {
            const tipo = args?.tipo === 'mensajes' ? 'mensajes' : 'nuevos';
            const tz = String(args?.zonaHoraria || 'America/Monterrey');
            const desdeMs = args?.desde ? new Date(args.desde).getTime() : null;
            const hastaMs = args?.hasta ? new Date(args.hasta).getTime() : null;
            const inRange = (ms) => Number.isFinite(ms)
                && (desdeMs == null || ms >= desdeMs)
                && (hastaMs == null || ms <= hastaMs);

            const DIAS = { Sun: 'Domingo', Mon: 'Lunes', Tue: 'Martes', Wed: 'Miércoles', Thu: 'Jueves', Fri: 'Viernes', Sat: 'Sábado' };
            const ORDEN = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
            const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', weekday: 'short' });
            const parts = (ms) => {
                const p = fmt.formatToParts(new Date(ms));
                let hora = 0, wd = 'Mon';
                for (const x of p) { if (x.type === 'hour') hora = parseInt(x.value, 10) % 24; if (x.type === 'weekday') wd = x.value; }
                return { hora, dia: DIAS[wd] || wd };
            };

            const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
            const porDiaMap = Object.fromEntries(ORDEN.map(d => [d, 0]));
            let total = 0;
            const bump = (ms) => { const { hora, dia } = parts(ms); porHora[hora].total++; if (dia in porDiaMap) porDiaMap[dia]++; total++; };

            const selection = args?.etiqueta ? { tags: [String(args.etiqueta).trim()] } : {};
            const ids = await resolveSegmentIds(redis, selection, [], 0);

            let truncado = false;
            if (tipo === 'nuevos') {
                for (const id of ids) {
                    const m = /^cand_(\d+)_/.exec(String(id));
                    if (!m) continue;
                    const ms = parseInt(m[1], 10);
                    if (inRange(ms)) bump(ms);
                }
            } else {
                // mensajes entrantes: lee historial por candidato (acotado por seguridad)
                const CAP = 1200;
                const scan = ids.slice(0, CAP);
                truncado = ids.length > CAP;
                const CHUNK = 50;
                for (let i = 0; i < scan.length; i += CHUNK) {
                    const batch = scan.slice(i, i + CHUNK);
                    const lists = await Promise.all(batch.map(id => getMessages(id, 300).catch(() => [])));
                    for (const msgs of lists) {
                        for (const msg of (msgs || [])) {
                            if (msg.from === 'me' || msg.from === 'bot') continue; // solo entrantes del candidato
                            const ms = new Date(msg.timestamp || msg.fecha || 0).getTime();
                            if (inRange(ms)) bump(ms);
                        }
                    }
                }
            }

            const horaPico = porHora.reduce((a, b) => b.total > a.total ? b : a, porHora[0]);
            const porDiaSemana = ORDEN.map(d => ({ dia: d, total: porDiaMap[d] }));
            const diaPico = porDiaSemana.reduce((a, b) => b.total > a.total ? b : a, porDiaSemana[0]);
            return {
                rango: { tipo, zonaHoraria: tz, desde: args?.desde || null, hasta: args?.hasta || null, etiqueta: args?.etiqueta || null },
                total,
                porHora,
                porDiaSemana,
                horaPico: { hora: horaPico.hora, total: horaPico.total },
                diaPico: { dia: diaPico.dia, total: diaPico.total },
                ...(truncado ? { truncado: true, escaneados: 1200 } : {})
            };
        }
    },

    // ───────────────────────── ESCRITURA (Fase 2) ─────────────────────────

    marcar_leido: {
        description: 'Marca un chat como leído/atendido (baja la burbuja de no leídos) o como no leído. leido=true lo marca atendido; leido=false lo regresa a no leído.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                leido: { type: 'boolean', description: 'true = marcar atendido/leído (default). false = marcar no leído.' }
            },
            required: ['candidateId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const leido = args?.leido !== false;
            const action = leido ? 'mark_handled' : 'mark_unread';
            const r = await callInternal(req, redis, '/api/chat', 'PUT', { action, candidateId: id });
            if (!r.ok) throw new Error(r.data?.error || `Fallo al marcar (${r.status})`);
            return { candidateId: id, leido };
        }
    },

    enviar_mensaje: {
        description: 'Envía un mensaje de texto libre al candidato por WhatsApp (admite variables como {{nombre}}). OJO: Meta solo permite texto libre si el candidato escribió en las últimas 24h; si está fuera de esa ventana, esta tool lo RECHAZA de antemano y debes usar enviar_plantilla. Pasa forzar:true para intentarlo igual bajo tu riesgo.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                texto: { type: 'string', description: 'Texto a enviar.' },
                forzar: { type: 'boolean', description: 'Enviar aunque esté fuera de la ventana de 24h (probablemente falle en Meta).' }
            },
            required: ['candidateId', 'texto']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            const texto = String(args?.texto || '').trim();
            if (!id) throw new Error('Falta candidateId');
            if (!texto) throw new Error('Falta el texto del mensaje');

            // Pre-vuelo: ventana de 24h. Fuera de ella, el texto libre suele fallar en Meta
            // (a veces de forma asíncrona vía webhook, por eso no basta con mirar la respuesta).
            const candidate = await getCandidateById(id);
            if (!candidate) throw new Error('Candidato no encontrado');
            if (!args?.forzar && !dentroVentana24h(candidate)) {
                throw new Error('El candidato está FUERA de la ventana de 24h de Meta: el texto libre será rechazado (error 131047). Usa enviar_plantilla, o pasa forzar:true para intentarlo igual.');
            }

            const r = await callInternal(req, redis, '/api/chat', 'POST', {
                candidateId: id, message: texto, type: 'text', senderId: 'mcp-grok', senderName: 'Grok (IA)'
            });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al enviar (${r.status})`);
            const estado = r.data?.message?.status || 'enviado';
            if (estado === 'failed') throw new Error(r.data?.message?.error || 'El envío falló en Meta');
            return {
                candidateId: id,
                enviado: true,
                estado,
                nota: 'estado=sent significa aceptado por Meta; una falla de entrega posterior (ej. 131047) puede llegar luego por webhook.'
            };
        }
    },

    enviar_banco_respuesta: {
        description: 'Envía una respuesta del banco de respuestas a un candidato. Elige la respuesta por su id o atajo; el servidor resuelve variables, frase dinámica y media, y la manda. Usa listar_banco_respuestas para ver las disponibles.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                quickReplyId: { type: 'string', description: 'ID de la respuesta del banco (preferido).' },
                atajo: { type: 'string', description: 'Atajo (shortcut) de la respuesta, si no tienes el id.' }
            },
            required: ['candidateId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const qrId = String(args?.quickReplyId || '').trim();
            const atajo = String(args?.atajo || '').trim();
            if (!qrId && !atajo) throw new Error('Indica quickReplyId o atajo');

            const raw = await redis.get('candidatic:quick_replies');
            const replies = raw ? JSON.parse(raw) : [];
            const qr = (Array.isArray(replies) ? replies : []).find(r =>
                (qrId && r.id === qrId) || (atajo && String(r.shortcut || '').toLowerCase() === atajo.toLowerCase()));
            if (!qr) throw new Error('Respuesta del banco no encontrada');

            const candidate = await getCandidateById(id);
            if (!candidate) throw new Error('Candidato no encontrado');

            // Resolver texto igual que el Chat Web: variables + frase dinámica (ambas pasan por substituteVariables).
            const caption = qr.message
                ? substituteDynamicPhrase(
                    substituteVariables(qr.message, candidate),
                    substituteVariables(qr.dynamicPhrase || '', candidate)
                  ).replace(/[^\S\n]{2,}/g, ' ').trim()
                : '';

            const images = [qr.imageUrl, qr.imageUrl2, qr.imageUrl3, qr.imageUrl4].filter(Boolean);
            const enviados = [];
            const send = async (body) => {
                const r = await callInternal(req, redis, '/api/chat', 'POST', { candidateId: id, senderId: 'mcp-grok', senderName: 'Grok (IA)', ...body });
                if (!r.ok || r.data?.success === false || r.data?.message?.status === 'failed') {
                    throw new Error(r.data?.message?.error || r.data?.error || `Fallo al enviar (${r.status})`);
                }
                enviados.push(body.type);
            };

            if (images.length) {
                await send({ type: 'image', mediaUrl: images[0], message: caption });
                for (const extra of images.slice(1)) await send({ type: 'image', mediaUrl: extra, message: '' });
            } else if (qr.documentUrl) {
                await send({ type: 'document', mediaUrl: qr.documentUrl, message: caption });
            } else if (qr.audioUrl) {
                await send({ type: 'audio', mediaUrl: qr.audioUrl, message: '', extraParams: { voice: !!qr.audioVoice } });
                if (caption) await send({ type: 'text', message: caption });
            } else {
                if (!caption) throw new Error('La respuesta no tiene texto ni media para enviar');
                await send({ type: 'text', message: caption });
            }

            return { candidateId: id, respuesta: qr.name || qr.shortcut || qr.id, enviado: true, partes: enviados };
        }
    },

    toggle_bot: {
        description: 'Activa o silencia al bot (Brenda, la IA) en el chat de un candidato. activar=false silencia la IA 24h (como cuando un humano toma el control); activar=true la reactiva.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                activar: { type: 'boolean', description: 'true = reactivar el bot. false = silenciarlo 24h.' }
            },
            required: ['candidateId', 'activar']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            if (typeof args?.activar !== 'boolean') throw new Error('activar debe ser true o false');
            const block = !args.activar; // activar el bot = quitar el bloqueo/silencio
            const r = await callInternal(req, redis, '/api/candidates/block', 'POST', { id, block });
            if (!r.ok) throw new Error(r.data?.error || `Fallo al cambiar el bot (${r.status})`);
            return { candidateId: id, botActivo: args.activar };
        }
    },

    etiquetar: {
        description: 'Pone o quita una etiqueta a un candidato. accion="add" la pone, accion="remove" la quita.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                etiqueta: { type: 'string', description: 'Nombre exacto de la etiqueta.' },
                accion: { type: 'string', enum: ['add', 'remove'], description: 'add (default) o remove.' }
            },
            required: ['candidateId', 'etiqueta']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            const etiqueta = String(args?.etiqueta || '').trim();
            if (!id) throw new Error('Falta candidateId');
            if (!etiqueta) throw new Error('Falta la etiqueta');
            const accion = args?.accion === 'remove' ? 'remove' : 'add';
            const r = await callInternal(req, redis, '/api/candidates/bulk-tag', 'POST', { ids: [id], tag: etiqueta, action: accion });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al etiquetar (${r.status})`);
            return { candidateId: id, etiqueta, accion };
        }
    },

    marcar_asistencia: {
        description: 'Marca o desmarca que un candidato SÍ llegó a su cita (asistencia). Es el mismo botón de "asistencia" del Chat Web / punto azul de la sección Candidatos. asistio=true la marca y guarda la fecha-hora actual; asistio=false la quita. Default: true. Para consultar si ya está marcada usa ver_perfil_candidato (campos asistencia / asistenciaAt).',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                asistio: { type: 'boolean', description: 'true (default) = marcar asistencia (llegó a la cita); false = quitar la marca.' }
            },
            required: ['candidateId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const turnOn = args?.asistio !== false;
            // Mismo shape que handleMarkAsistencia en ChatSection.jsx: prender guarda la
            // bandera + timestamp; apagar solo baja la bandera (deja asistenciaAt como estaba).
            const updates = turnOn
                ? { asistencia: true, asistenciaAt: new Date().toISOString() }
                : { asistencia: false };
            const r = await callInternal(req, redis, '/api/candidates', 'PUT', { id, ...updates });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al marcar asistencia (${r.status})`);
            return { candidateId: id, asistencia: turnOn, asistenciaAt: turnOn ? updates.asistenciaAt : null };
        }
    },

    enviar_plantilla: {
        description: 'Envía una plantilla oficial de Meta a un candidato. Sirve para contactar a quien está FUERA de la ventana de 24h (donde enviar_mensaje de texto libre falla con error 131047). El nombre del candidato se rellena solo. Usa listar_plantillas para ver los nombres disponibles.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                plantilla: { type: 'string', description: 'Nombre exacto de la plantilla (de listar_plantillas).' }
            },
            required: ['candidateId', 'plantilla']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            const nombre = String(args?.plantilla || '').trim();
            if (!id) throw new Error('Falta candidateId');
            if (!nombre) throw new Error('Falta el nombre de la plantilla');

            const tr = await callInternal(req, redis, '/api/whatsapp/templates', 'GET');
            const templates = Array.isArray(tr.data?.data) ? tr.data.data : [];
            const tpl = templates.find(t => String(t.name || '').toLowerCase() === nombre.toLowerCase());
            if (!tpl) throw new Error(`Plantilla "${nombre}" no encontrada. Usa listar_plantillas.`);

            const r = await callInternal(req, redis, '/api/chat', 'POST', {
                candidateId: id, type: 'template', templateData: tpl, senderId: 'mcp-grok', senderName: 'Grok (IA)'
            });
            if (!r.ok || r.data?.success === false || r.data?.message?.status === 'failed') {
                throw new Error(r.data?.message?.error || r.data?.error || `Fallo al enviar plantilla (${r.status})`);
            }
            return { candidateId: id, plantilla: tpl.name, enviado: true };
        }
    },

    crear_recordatorio: {
        description: 'Programa un recordatorio (campanita) para un candidato: a la fecha/hora indicada se le enviará el mensaje. cuando debe ser una fecha-hora futura en ISO 8601 (ej. 2026-10-16T09:30:00-06:00).',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                mensaje: { type: 'string', description: 'Texto del recordatorio a enviar.' },
                cuando: { type: 'string', description: 'Fecha-hora futura en ISO 8601 (incluye zona, ej. -06:00 para Monterrey).' }
            },
            required: ['candidateId', 'mensaje', 'cuando']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            const mensaje = String(args?.mensaje || '').trim();
            const cuando = String(args?.cuando || '').trim();
            if (!id) throw new Error('Falta candidateId');
            if (!mensaje) throw new Error('Falta el mensaje');
            if (!cuando || isNaN(new Date(cuando).getTime())) throw new Error('cuando debe ser una fecha ISO válida');
            if (new Date(cuando).getTime() <= Date.now()) throw new Error('cuando debe ser una fecha futura');

            const candidate = await getCandidateById(id);
            if (!candidate) throw new Error('Candidato no encontrado');

            const r = await callInternal(req, redis, '/api/candidate-reminders', 'POST', {
                candidateId: id,
                whatsapp: candidate.whatsapp,
                nombre: candidate.nombreReal || candidate.nombre || candidate.whatsapp,
                message: mensaje,
                scheduledAt: cuando
            });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al crear recordatorio (${r.status})`);
            return { candidateId: id, para: cuando, recordatorioId: r.data?.reminder?.id || null };
        }
    },

    bloquear: {
        description: 'BLOQUEA DE VERDAD al candidato en Meta/WhatsApp (no podrá volver a escribir). Es irreversible salvo que lo desbloquees. Distinto de toggle_bot (que solo silencia a la IA). bloquear=false lo desbloquea.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                bloquear: { type: 'boolean', description: 'true = bloquear en Meta (default). false = desbloquear.' }
            },
            required: ['candidateId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const block = args?.bloquear !== false;
            const r = await callInternal(req, redis, '/api/candidates/meta-block', 'POST', { id, block });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al bloquear (${r.status})`);
            return { candidateId: id, bloqueadoEnMeta: block };
        }
    },

    // ───────────────────── PROYECTOS (CRM Manual) ─────────────────────

    listar_proyectos: {
        description: 'Lista los proyectos del CRM Manual con sus pasos (columnas del tablero). Úsalo para ver qué proyectos existen y sus etapas.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis, req }) => {
            const r = await callInternal(req, redis, '/api/manual_projects', 'GET');
            const projects = Array.isArray(r.data?.data) ? r.data.data : [];
            return {
                proyectos: projects.map(p => ({
                    id: p.id,
                    nombre: p.name,
                    descripcion: p.description || '',
                    color: p.color || null,
                    pasos: (p.steps || []).map(s => ({ stepId: s.id, nombre: s.name })),
                    creado: p.createdAt || null
                }))
            };
        }
    },

    ver_candidatos_proyecto: {
        description: 'Muestra el tablero de un proyecto: sus pasos y qué candidatos hay en cada paso. Es la vista de "todo lo que pasa" en ese proyecto.',
        inputSchema: {
            type: 'object',
            properties: { projectId: { type: 'string', description: 'ID del proyecto (de listar_proyectos).' } },
            required: ['projectId']
        },
        handler: async (args, { redis, req }) => {
            const pid = String(args?.projectId || '').trim();
            if (!pid) throw new Error('Falta projectId');

            const listR = await callInternal(req, redis, '/api/manual_projects', 'GET');
            const project = (Array.isArray(listR.data?.data) ? listR.data.data : []).find(p => p.id === pid);
            if (!project) throw new Error('Proyecto no encontrado');

            const candR = await callInternal(req, redis, `/api/manual_projects?id=${encodeURIComponent(pid)}&view=candidates`, 'GET');
            const candidates = Array.isArray(candR.data?.candidates) ? candR.data.candidates : [];

            const steps = (project.steps || []).map(s => ({ stepId: s.id, nombre: s.name, candidatos: [] }));
            const byStep = new Map(steps.map(s => [s.stepId, s]));
            for (const c of candidates) {
                const bucket = byStep.get(c.manualProjectStepId);
                const row = {
                    candidateId: c.id,
                    nombre: (c.nombreReal && c.nombreReal.trim()) || c.nombre || 'Sin nombre',
                    telefono: c.whatsapp || null
                };
                if (bucket) bucket.candidatos.push(row);
            }
            return { proyecto: project.name, projectId: pid, total: candidates.length, pasos: steps };
        }
    },

    meter_en_proyecto: {
        description: 'Mete (vincula) un candidato a un proyecto, en un paso. Si no das stepId, entra al primer paso. Un candidato solo puede estar en un proyecto a la vez (se saca de otros automáticamente).',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'ID del proyecto.' },
                candidateId: { type: 'string', description: 'ID del candidato.' },
                stepId: { type: 'string', description: 'ID del paso (opcional; default = primer paso).' }
            },
            required: ['projectId', 'candidateId']
        },
        handler: async (args, { redis, req }) => {
            const projectId = String(args?.projectId || '').trim();
            const candidateId = String(args?.candidateId || '').trim();
            if (!projectId || !candidateId) throw new Error('Faltan projectId o candidateId');
            const body = { action: 'linkCandidate', projectId, candidateId };
            if (args?.stepId) body.stepId = String(args.stepId).trim();
            const r = await callInternal(req, redis, '/api/manual_projects', 'POST', body);
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al meter en proyecto (${r.status})`);
            return { projectId, candidateId, metido: true };
        }
    },

    sacar_de_proyecto: {
        description: 'Saca (desvincula) un candidato de un proyecto.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'ID del proyecto.' },
                candidateId: { type: 'string', description: 'ID del candidato.' }
            },
            required: ['projectId', 'candidateId']
        },
        handler: async (args, { redis, req }) => {
            const projectId = String(args?.projectId || '').trim();
            const candidateId = String(args?.candidateId || '').trim();
            if (!projectId || !candidateId) throw new Error('Faltan projectId o candidateId');
            const r = await callInternal(req, redis, '/api/manual_projects', 'POST', { action: 'unlinkCandidate', projectId, candidateId });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al sacar del proyecto (${r.status})`);
            return { projectId, candidateId, sacado: true };
        }
    },

    mover_en_proyecto: {
        description: 'Mueve un candidato a otro paso dentro del mismo proyecto. Usa ver_candidatos_proyecto o listar_proyectos para ver los stepId.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'ID del proyecto.' },
                candidateId: { type: 'string', description: 'ID del candidato.' },
                stepId: { type: 'string', description: 'ID del paso destino.' }
            },
            required: ['projectId', 'candidateId', 'stepId']
        },
        handler: async (args, { redis, req }) => {
            const projectId = String(args?.projectId || '').trim();
            const candidateId = String(args?.candidateId || '').trim();
            const stepId = String(args?.stepId || '').trim();
            if (!projectId || !candidateId || !stepId) throw new Error('Faltan projectId, candidateId o stepId');
            const r = await callInternal(req, redis, '/api/manual_projects', 'POST', { action: 'moveCandidate', projectId, candidateId, stepId });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al mover (${r.status})`);
            return { projectId, candidateId, stepId, movido: true };
        }
    },

    crear_proyecto: {
        description: 'Crea un proyecto nuevo en el CRM Manual. Nace con un paso "Inicio". Luego puedes agregar más pasos con agregar_paso.',
        inputSchema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre del proyecto.' },
                descripcion: { type: 'string', description: 'Descripción (opcional).' },
                color: { type: 'string', description: 'Color hex (opcional, ej. #3b82f6).' }
            },
            required: ['nombre']
        },
        handler: async (args, { redis, req }) => {
            const nombre = String(args?.nombre || '').trim();
            if (!nombre) throw new Error('Falta el nombre del proyecto');
            const body = { name: nombre };
            if (args?.descripcion) body.description = String(args.descripcion);
            if (args?.color) body.color = String(args.color);
            const r = await callInternal(req, redis, '/api/manual_projects', 'POST', body);
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al crear proyecto (${r.status})`);
            const p = r.data?.data;
            return { creado: true, projectId: p?.id, nombre: p?.name, pasos: (p?.steps || []).map(s => ({ stepId: s.id, nombre: s.name })) };
        }
    },

    agregar_paso: {
        description: 'Agrega un paso (columna) nuevo al final de un proyecto.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'ID del proyecto.' },
                nombre: { type: 'string', description: 'Nombre del nuevo paso.' }
            },
            required: ['projectId', 'nombre']
        },
        handler: async (args, { redis, req }) => {
            const projectId = String(args?.projectId || '').trim();
            const nombre = String(args?.nombre || '').trim();
            if (!projectId || !nombre) throw new Error('Faltan projectId o nombre del paso');

            const listR = await callInternal(req, redis, '/api/manual_projects', 'GET');
            const project = (Array.isArray(listR.data?.data) ? listR.data.data : []).find(p => p.id === projectId);
            if (!project) throw new Error('Proyecto no encontrado');

            const newStep = { id: `step_${Date.now()}_${randomBytes(3).toString('hex')}`, name: nombre };
            const steps = [...(project.steps || []), newStep];
            const r = await callInternal(req, redis, '/api/manual_projects', 'POST', { action: 'updateSteps', projectId, steps });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al agregar paso (${r.status})`);
            return { projectId, paso: { stepId: newStep.id, nombre }, agregado: true };
        }
    },

    eliminar_proyecto: {
        description: 'ELIMINA un proyecto completo del CRM Manual (y desvincula a todos sus candidatos). Es destructivo e irreversible. Pide confirmación al usuario antes de usarlo.',
        inputSchema: {
            type: 'object',
            properties: { projectId: { type: 'string', description: 'ID del proyecto a eliminar.' } },
            required: ['projectId']
        },
        handler: async (args, { redis, req }) => {
            const projectId = String(args?.projectId || '').trim();
            if (!projectId) throw new Error('Falta projectId');
            const r = await callInternal(req, redis, `/api/manual_projects?id=${encodeURIComponent(projectId)}`, 'DELETE');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al eliminar proyecto (${r.status})`);
            return { projectId, eliminado: true };
        }
    },

    // ───────────────────── FLUJOS (editor de flujos / nodos) ─────────────────────
    // Acceso completo a la sección de Flujos. Todas pasan por /api/flows vía
    // callInternal, así heredan la auth de SuperAdmin y los side-effects del endpoint
    // (activatedAt al activar, limpieza de contadores/exec-set al borrar, invalidación
    // de caché). No reimplementan nada de flows.js.

    listar_flujos: {
        description: 'Lista TODOS los flujos (resumen), de cualquier tipo. Devuelve id, nombre, si está activo, "tipo" (estandar = en vivo/perfil completo, lista = manual sobre lista filtrada, incompletos = incompletos en silencio por cron), cuántos nodos/aristas tiene, los tipos de nodo crudos y "nombresDeNodos" (los nombres visibles de cada nodo, tal como los ve el reclutador en el canvas). Usa ver_flujo para traer los nodos completos de uno.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis, req }) => {
            const r = await callInternal(req, redis, '/api/flows', 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al listar flujos (${r.status})`);
            const flows = Array.isArray(r.data?.flows) ? r.data.flows : [];
            return {
                total: flows.length,
                flujos: flows.map(f => ({
                    id: f.id,
                    nombre: f.name || 'Flujo sin nombre',
                    activo: !!f.active,
                    tipo: classifyFlowTipo(f.nodes),
                    numNodos: Array.isArray(f.nodes) ? f.nodes.length : 0,
                    numAristas: Array.isArray(f.edges) ? f.edges.length : 0,
                    tiposDeNodo: Array.from(new Set((f.nodes || []).map(n => n.type).filter(Boolean))),
                    nombresDeNodos: (f.nodes || []).map(n => nodeDisplayName(n)),
                    actualizado: f.updatedAt || null
                }))
            };
        }
    },

    ver_flujo: {
        description: 'Devuelve un flujo COMPLETO: nombre, activo, los arreglos nodes y edges tal cual se guardan (cada nodo con su id, type, position y data), más un "indice" liviano [{nodeId, tipo, nombre, alias}] para ubicar cada nodo. "nombre" es el NOMBRE VISIBLE del nodo tal como lo ve el reclutador en el canvas (etiqueta del tipo + alias si tiene, p. ej. "Mandar Botones / Opciones — Botones de fecha Metalsa"); "tipo" es el type crudo (accion_botones); "alias" es solo el nombre personalizado (data.customName) o null. Léelo antes de editar: para guardar cambios con guardar_flujo debes mandar el arreglo nodes/edges completo ya modificado.',
        inputSchema: {
            type: 'object',
            properties: { flujoId: { type: 'string', description: 'ID del flujo (de listar_flujos).' } },
            required: ['flujoId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.flujoId || '').trim();
            if (!id) throw new Error('Falta flujoId');
            const r = await callInternal(req, redis, `/api/flows?id=${encodeURIComponent(id)}`, 'GET');
            if (r.status === 404) throw new Error('Flujo no encontrado');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer el flujo (${r.status})`);
            const f = r.data?.flow;
            if (!f) throw new Error('Flujo no encontrado');
            const nodes = Array.isArray(f.nodes) ? f.nodes : [];
            return {
                id: f.id,
                nombre: f.name || null,
                activo: !!f.active,
                tipo: classifyFlowTipo(nodes),
                // Índice liviano para localizar un nodo por su nombre visible, su alias o su tipo
                // sin tener que escanear el arreglo nodes completo. "nombre" = lo que ve el humano
                // en el canvas (etiqueta del tipo + alias); "alias" = solo data.customName.
                indice: nodes.map(n => ({
                    nodeId: n.id,
                    tipo: n.type,
                    nombre: nodeDisplayName(n),
                    alias: (n.data?.customName || '').trim() || null
                })),
                nodes,
                edges: Array.isArray(f.edges) ? f.edges : [],
                creado: f.createdAt || null,
                actualizado: f.updatedAt || null,
                activadoEn: f.activatedAt || null
            };
        }
    },

    ver_catalogos_flujos: {
        description: 'Devuelve los valores válidos para configurar nodos: municipios de Nuevo León, categorías, escolaridades, etiquetas y vacantes (con id y nombre). Consúltalo antes de editar la data de un nodo para no poner valores inválidos.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis, req }) => {
            const r = await callInternal(req, redis, '/api/flows?meta=1', 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer catálogos (${r.status})`);
            return {
                municipios: r.data?.municipios || [],
                categorias: r.data?.categorias || [],
                escolaridades: r.data?.escolaridades || [],
                etiquetas: r.data?.tags || [],
                vacantes: r.data?.vacantes || []
            };
        }
    },

    crear_flujo: {
        description: 'Crea un flujo NUEVO (vacío, inactivo) con solo su nodo inicial. tipoRaiz="estandar" (en vivo, arranca con nodo Inicio), "lista" (manual, sobre una lista filtrada) o "incompletos" (incompletos en silencio por cron). Después usa ver_flujo + guardar_flujo para armar los nodos.',
        inputSchema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre del flujo.' },
                tipoRaiz: { type: 'string', enum: ['estandar', 'lista', 'incompletos', 'sin_extraccion'], description: 'Tipo de nodo raíz (default "estandar"). "sin_extraccion" = incompletos de cierta etiqueta a los que Brenda nunca extrae; el flujo los atiende desde el primer mensaje.' }
            },
            required: ['nombre']
        },
        handler: async (args, { redis, req }) => {
            const nombre = String(args?.nombre || '').trim();
            if (!nombre) throw new Error('Falta el nombre del flujo');
            const rootType = args?.tipoRaiz === 'lista' ? 'lista' : args?.tipoRaiz === 'incompletos' ? 'incompletos' : args?.tipoRaiz === 'sin_extraccion' ? 'sin_extraccion' : 'estandar';
            const r = await callInternal(req, redis, '/api/flows', 'POST', { name: nombre, rootType });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al crear el flujo (${r.status})`);
            const f = r.data?.flow;
            return { flujoId: f?.id || null, nombre: f?.name || nombre, activo: !!f?.active, creado: true };
        }
    },

    guardar_flujo: {
        description: 'Guarda cambios en un flujo. Puedes cambiar nombre, activo (true/false) y/o reemplazar por COMPLETO los arreglos nodes y edges. Los nodos/aristas NO se fusionan: se sustituye el arreglo entero, así que primero lee con ver_flujo, modifica el arreglo y mándalo completo. Para ponerle o cambiar el nombre a un nodo, edita su data.customName (es solo una etiqueta; no cambia el comportamiento del nodo). Activar un flujo lo pone en vivo para los candidatos.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo a guardar.' },
                nombre: { type: 'string', description: 'Nuevo nombre (opcional).' },
                activo: { type: 'boolean', description: 'true = activar (ponerlo en vivo), false = desactivar (opcional).' },
                nodes: { type: 'array', items: { type: 'object' }, description: 'Arreglo COMPLETO de nodos (reemplaza el actual). Cada nodo: {id, type, position:{x,y}, data:{...}}.' },
                edges: { type: 'array', items: { type: 'object' }, description: 'Arreglo COMPLETO de aristas/conexiones (reemplaza el actual).' }
            },
            required: ['flujoId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.flujoId || '').trim();
            if (!id) throw new Error('Falta flujoId');
            const body = {};
            if (args?.nombre !== undefined) body.name = String(args.nombre);
            if (args?.activo !== undefined) {
                if (typeof args.activo !== 'boolean') throw new Error('activo debe ser true o false');
                body.active = args.activo;
            }
            if (args?.nodes !== undefined) {
                if (!Array.isArray(args.nodes)) throw new Error('nodes debe ser un arreglo');
                body.nodes = args.nodes;
            }
            if (args?.edges !== undefined) {
                if (!Array.isArray(args.edges)) throw new Error('edges debe ser un arreglo');
                body.edges = args.edges;
            }
            if (Object.keys(body).length === 0) throw new Error('Nada que guardar: manda nombre, activo, nodes y/o edges');

            const r = await callInternal(req, redis, `/api/flows?id=${encodeURIComponent(id)}`, 'PUT', body);
            if (r.status === 404) throw new Error('Flujo no encontrado');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al guardar el flujo (${r.status})`);
            const f = r.data?.flow;
            return {
                flujoId: f?.id || id,
                nombre: f?.name || null,
                activo: !!f?.active,
                numNodos: Array.isArray(f?.nodes) ? f.nodes.length : 0,
                numAristas: Array.isArray(f?.edges) ? f.edges.length : 0,
                guardado: true
            };
        }
    },

    eliminar_flujo: {
        description: 'ELIMINA un flujo completo (y sus contadores/registros de ejecución). Es destructivo e irreversible. Pide confirmación al usuario antes de usarlo.',
        inputSchema: {
            type: 'object',
            properties: { flujoId: { type: 'string', description: 'ID del flujo a eliminar.' } },
            required: ['flujoId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.flujoId || '').trim();
            if (!id) throw new Error('Falta flujoId');
            const r = await callInternal(req, redis, `/api/flows?id=${encodeURIComponent(id)}`, 'DELETE');
            if (r.status === 404) throw new Error('Flujo no encontrado');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al eliminar el flujo (${r.status})`);
            return { flujoId: id, eliminado: true };
        }
    },

    ver_contadores_flujo: {
        description: 'Métricas de los nodos "contador" de un flujo: cuántos candidatos pasaron por cada uno, con desglose total/hoy/ayer/estaSemana/esteMes. Devuelve {} si el flujo no tiene nodos contador.',
        inputSchema: {
            type: 'object',
            properties: { flujoId: { type: 'string', description: 'ID del flujo.' } },
            required: ['flujoId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.flujoId || '').trim();
            if (!id) throw new Error('Falta flujoId');
            const r = await callInternal(req, redis, `/api/flows?id=${encodeURIComponent(id)}&mode=counters`, 'GET');
            if (r.status === 404) throw new Error('Flujo no encontrado');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer contadores (${r.status})`);
            return { flujoId: id, contadores: r.data?.counters || {} };
        }
    },

    ver_rango_contador: {
        description: 'Cuántos candidatos pasaron por UN nodo contador en un rango de fechas personalizado (inclusive ambos extremos, zona Monterrey). from/to en formato YYYY-MM-DD.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                nodeId: { type: 'string', description: 'ID del nodo contador (de ver_flujo).' },
                desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (Monterrey).' },
                hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD (Monterrey).' }
            },
            required: ['flujoId', 'nodeId', 'desde', 'hasta']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.flujoId || '').trim();
            const nodeId = String(args?.nodeId || '').trim();
            const from = String(args?.desde || '').trim();
            const to = String(args?.hasta || '').trim();
            if (!id || !nodeId) throw new Error('Faltan flujoId o nodeId');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('desde/hasta deben ser YYYY-MM-DD');
            const qs = `id=${encodeURIComponent(id)}&mode=counter_range&nodeId=${encodeURIComponent(nodeId)}&from=${from}&to=${to}`;
            const r = await callInternal(req, redis, `/api/flows?${qs}`, 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer el rango (${r.status})`);
            return { flujoId: id, nodeId, desde: from, hasta: to, total: r.data?.count || 0 };
        }
    },

    ver_metricas_etiqueta_flujos: {
        description: 'Tablero de altas (perfiles capturados) por ETIQUETA en un rango. rango="hoy" (default), "ayer", "semana", "mes", o manda desde/hasta (YYYY-MM-DD) para un rango exacto. Devuelve el conteo por etiqueta, el total y los sin etiqueta.',
        inputSchema: {
            type: 'object',
            properties: {
                rango: { type: 'string', enum: ['hoy', 'ayer', 'semana', 'mes'], description: 'Rango predefinido (ignóralo si usas desde/hasta).' },
                desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (opcional, para rango exacto).' },
                hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD (opcional).' }
            }
        },
        handler: async (args, { redis, req }) => {
            const params = new URLSearchParams({ mode: 'tag_metrics' });
            if (args?.rango) params.set('rango', String(args.rango));
            if (args?.desde) params.set('desde', String(args.desde));
            if (args?.hasta) params.set('hasta', String(args.hasta));
            const r = await callInternal(req, redis, `/api/flows?${params.toString()}`, 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer métricas (${r.status})`);
            return {
                periodo: r.data?.label || null,
                metricas: r.data?.metrics || {},
                total: r.data?.total || 0,
                sinEtiqueta: r.data?.untagged || 0
            };
        }
    },

    listar_checkpoints_flujos: {
        description: 'Lista TODOS los Check Points de TODOS los flujos (flowId, nombre del flujo, nodeId y nombre del check point). Sirve para configurar nodos "Condición: Check Point" o el perfil de prueba.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis, req }) => {
            const r = await callInternal(req, redis, '/api/flows?mode=checkpoints', 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al listar check points (${r.status})`);
            return { checkpoints: r.data?.checkpoints || [] };
        }
    },

    ver_checkpoint: {
        description: 'Muestra QUIÉNES pasaron por un Check Point concreto y CUÁNDO (cada candidato queda marcado automáticamente al pasar por el nodo). Pasa flujoId + nodeId (obtenlos de listar_checkpoints_flujos). Devuelve el roster ordenado del paso más reciente al más antiguo, paginable con limit/offset (default 50, máx 500). Si pasas candidateId, devuelve en cambio el historial COMPLETO de ese candidato por este check point (todas las veces que pasó).',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo que contiene el Check Point.' },
                nodeId: { type: 'string', description: 'ID del nodo Check Point.' },
                candidateId: { type: 'string', description: 'Opcional: si lo pasas, devuelve el historial completo (todas las fechas) de ese candidato por este check point en vez del roster.' },
                limit: { type: 'number', description: 'Tamaño de página del roster (default 50, máx 500).' },
                offset: { type: 'number', description: 'Desplazamiento del roster (default 0).' }
            },
            required: ['flujoId', 'nodeId']
        },
        handler: async (args, { redis, req }) => {
            const flowId = String(args?.flujoId || '').trim();
            const nodeId = String(args?.nodeId || '').trim();
            if (!flowId) throw new Error('Falta flujoId');
            if (!nodeId) throw new Error('Falta nodeId');
            const base = `${CHECKPOINT_PREFIX}${flowId}:${nodeId}`;

            // El nombre del check point vive en el flujo (node.data.name), no en Redis —
            // se resuelve en vivo por flowId+nodeId (rename retroactivo).
            let nombre = null, flujoNombre = null;
            try {
                const meta = await callInternal(req, redis, '/api/flows?mode=checkpoints', 'GET');
                const cp = (meta.data?.checkpoints || []).find(c => c.flowId === flowId && c.nodeId === nodeId);
                if (cp) { nombre = cp.name || null; flujoNombre = cp.flowName || null; }
            } catch { /* el nombre es cosmético; no bloquea la lectura del roster */ }

            // Historial COMPLETO de un candidato puntual (todas las veces que pasó).
            if (args?.candidateId) {
                const cid = String(args.candidateId).trim();
                const raw = await redis.lrange(`${base}:log:${cid}`, 0, -1).catch(() => []);
                const pasos = (raw || []).map(ms => new Date(Number(ms)).toISOString());
                const c = await getCandidateById(cid).catch(() => null);
                return {
                    checkpoint: { flujoId: flowId, nodeId, nombre, flujo: flujoNombre },
                    candidateId: cid,
                    nombre: c ? ((c.nombreReal && c.nombreReal.trim()) || c.nombre || 'Sin nombre') : null,
                    telefono: c?.whatsapp || null,
                    veces: pasos.length,
                    pasos
                };
            }

            // Roster: quién pasó + su paso MÁS reciente (HASH `:last`).
            const lastMap = (await redis.hgetall(`${base}:last`).catch(() => ({}))) || {};
            const entries = Object.entries(lastMap)
                .map(([id, ms]) => ({ id, ms: Number(ms) || 0 }))
                .sort((a, b) => b.ms - a.ms);
            const total = entries.length;
            const limit = Math.min(Math.max(Number(args?.limit) || 50, 1), 500);
            const offset = Math.max(Number(args?.offset) || 0, 0);
            const page = entries.slice(offset, offset + limit);
            const candidatos = await Promise.all(page.map(async (e) => {
                const c = await getCandidateById(e.id).catch(() => null);
                return {
                    candidateId: e.id,
                    nombre: c ? ((c.nombreReal && c.nombreReal.trim()) || c.nombre || 'Sin nombre') : null,
                    telefono: c?.whatsapp || null,
                    ultimoPaso: e.ms ? new Date(e.ms).toISOString() : null
                };
            }));
            return {
                checkpoint: { flujoId: flowId, nodeId, nombre, flujo: flujoNombre },
                total,
                mostrados: candidatos.length,
                offset,
                hayMas: offset + candidatos.length < total,
                candidatos
            };
        }
    },

    ver_candidatos_lista_flujo: {
        description: 'Para un flujo de tipo LISTA (manual): devuelve los candidatos que caen en su lista filtrada y si ya se les corrió el flujo (executed). Filtra por perfil ("todos"/"completo"/"incompleto"), etiquetas y ventana de 24h. Usa los ids con correr_flujo_candidato.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo (de tipo lista).' },
                perfil: { type: 'string', enum: ['todos', 'completo', 'incompleto'], description: 'Filtro de perfil (default "todos").' },
                etiquetas: { type: 'array', items: { type: 'string' }, description: 'Etiquetas a exigir (opcional).' },
                dentro24h: { type: 'boolean', description: 'true = solo los que escribieron en las últimas 24h.' }
            },
            required: ['flujoId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.flujoId || '').trim();
            if (!id) throw new Error('Falta flujoId');
            const params = new URLSearchParams({ id, mode: 'filtered_candidates' });
            params.set('profileFilter', args?.perfil === 'completo' || args?.perfil === 'incompleto' ? args.perfil : 'todos');
            if (Array.isArray(args?.etiquetas) && args.etiquetas.length) params.set('tags', args.etiquetas.join(','));
            if (args?.dentro24h) params.set('within24h', '1');
            const r = await callInternal(req, redis, `/api/flows?${params.toString()}`, 'GET');
            if (r.status === 404) throw new Error('Flujo no encontrado');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer candidatos (${r.status})`);
            const candidatos = Array.isArray(r.data?.candidates) ? r.data.candidates : [];
            return {
                flujoId: id,
                total: r.data?.total || candidatos.length,
                candidatos: candidatos.map(c => ({
                    candidateId: c.id,
                    nombre: (c.nombreReal && c.nombreReal.trim()) || c.nombre || 'Sin nombre',
                    telefono: c.whatsapp || null,
                    yaCorrido: c.executed === true
                }))
            };
        }
    },

    probar_flujo: {
        description: 'Prueba un flujo contra un número real SIN tocar ni persistir al candidato (perfil temporal en memoria). Los mensajes de prueba SÍ se envían a ese WhatsApp. perfil="completo" o "incompleto"; opcionalmente etiquetas, vacanteActual, checkpoints ya pasados [{flowId,nodeId}] y opcionMenu (título del botón/fila a simular, o "timeout"). Devuelve si el candidato de prueba pasó el filtro de entrada.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo a probar.' },
                whatsapp: { type: 'string', description: 'Número de WhatsApp real para la prueba (recibirá los mensajes).' },
                perfil: { type: 'string', enum: ['completo', 'incompleto'], description: 'Perfil temporal (default "completo").' },
                etiquetas: { type: 'array', items: { type: 'string' }, description: 'Etiquetas del perfil de prueba.' },
                vacanteActual: { type: 'string', description: 'Vacante actual simulada.' },
                checkpoints: { type: 'array', items: { type: 'object' }, description: 'Check points ya pasados: [{flowId, nodeId}].' },
                opcionMenu: { type: 'string', description: 'Opción de menú a simular (título exacto del botón/fila, o "timeout").' }
            },
            required: ['flujoId', 'whatsapp']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.flujoId || '').trim();
            const whatsapp = String(args?.whatsapp || '').trim();
            if (!id) throw new Error('Falta flujoId');
            if (!whatsapp) throw new Error('Falta whatsapp');
            const testProfile = {
                perfil: args?.perfil === 'incompleto' ? 'incompleto' : 'completo',
                tags: Array.isArray(args?.etiquetas) ? args.etiquetas : [],
                vacanteActual: args?.vacanteActual ? String(args.vacanteActual) : '',
                checkpoints: Array.isArray(args?.checkpoints) ? args.checkpoints : [],
                simulatedOption: args?.opcionMenu ? String(args.opcionMenu) : ''
            };
            const r = await callInternal(req, redis, `/api/flows?id=${encodeURIComponent(id)}`, 'POST', { action: 'test', whatsapp, testProfile });
            if (r.status === 404) throw new Error('Flujo no encontrado');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al probar el flujo (${r.status})`);
            return { flujoId: id, whatsapp, perfilProbado: r.data?.candidate?.nombre || null, paso: r.data?.passed === true };
        }
    },

    correr_flujo_candidato: {
        description: 'Corre un flujo de tipo LISTA (manual) sobre UN candidato concreto (le envía los mensajes del flujo). Por defecto no lo vuelve a correr si ya se le corrió; usa forzar=true para correrlo de nuevo. Usa ver_candidatos_lista_flujo para obtener los candidateId.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo (de tipo lista).' },
                candidateId: { type: 'string', description: 'ID del candidato.' },
                forzar: { type: 'boolean', description: 'true = correrlo aunque ya se le haya corrido antes.' }
            },
            required: ['flujoId', 'candidateId']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.flujoId || '').trim();
            const candidateId = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta flujoId');
            if (!candidateId) throw new Error('Falta candidateId');
            const r = await callInternal(req, redis, `/api/flows?id=${encodeURIComponent(id)}`, 'POST', { action: 'run_list_item', candidateId, force: args?.forzar === true });
            if (r.status === 404) throw new Error('Flujo o candidato no encontrado');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al correr el flujo (${r.status})`);
            return { flujoId: id, candidateId, yaEstabaCorrido: r.data?.alreadyExecuted === true };
        }
    },

    // ──────────────── NODOS (genérico, cualquier tipo) ────────────────
    // CRUD por NODO sin reenviar el flujo entero: cada tool hace read-modify-write
    // contra el flujo y guarda vía /api/flows (callInternal → auth SuperAdmin +
    // side-effects + invalidación de caché). guardar_flujo sigue existiendo para
    // reemplazos masivos; estas tools son para tocar UN nodo/arista a la vez.

    ver_nodo: {
        description: 'Lee UN nodo de un flujo (de cualquier tipo): su id, type, nombre visible, position y data completa, más sus aristas entrantes y salientes (origen/destino y la salida/sourceHandle de cada una). Úsalo para inspeccionar la configuración exacta de un nodo antes de editarlo, o para copiar la forma de su data al crear otro igual.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                nodeId: { type: 'string', description: 'ID del nodo.' }
            },
            required: ['flujoId', 'nodeId']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            const nodeId = String(args?.nodeId || '').trim();
            if (!flujoId) throw new Error('Falta flujoId');
            if (!nodeId) throw new Error('Falta nodeId');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? f.nodes : [];
            const edges = Array.isArray(f.edges) ? f.edges : [];
            const n = nodes.find(x => x?.id === nodeId);
            if (!n) throw new Error('Nodo no encontrado en ese flujo');
            return {
                flujoId,
                nodo: {
                    id: n.id,
                    tipo: n.type,
                    nombre: nodeDisplayName(n),
                    alias: (n.data?.customName || '').trim() || null,
                    position: n.position || null,
                    data: n.data || {}
                },
                aristasEntrantes: edges.filter(e => e.target === nodeId).map(e => ({ id: e.id, origen: e.source, salida: e.sourceHandle || null })),
                aristasSalientes: edges.filter(e => e.source === nodeId).map(e => ({ id: e.id, destino: e.target, salida: e.sourceHandle || null }))
            };
        }
    },

    crear_nodo: {
        description: 'Crea UN nodo NUEVO de cualquier tipo en un flujo. SOLO inserta el nodo con su data; NO lo conecta (usa conectar_nodos para las aristas). Para saber qué "data" lleva cada tipo, lee con ver_nodo un nodo del mismo tipo en otro flujo y copia su forma, y consulta ver_catalogos_flujos para valores válidos (municipios/categorías/etiquetas/vacantes). Para nodos de ubicación usa mejor crear_nodo_ubicacion. Devuelve el nodeId nuevo. Tipos válidos: inicio, inicio_lista, inicio_incompleto_silencio, etiqueta, condicion_genero, condicion_edad, condicion_municipio, condicion_categoria, condicion_escolaridad, condicion_checkpoint, accion_whatsapp, accion_vacante, accion_whatsapp_personalizado, accion_botones, accion_ubicacion, frase_dinamica, accion_etiqueta, accion_quitar_etiqueta, accion_limpiar_etiquetas, accion_recordatorio, accion_proyecto, accion_marcar_leido, accion_desactivar_bot, accion_reactivar_bot, esperando_respuesta, contador, checkpoint, test, nota, bg, texto.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                tipo: { type: 'string', description: 'Tipo de nodo (ver lista en la descripción).' },
                data: { type: 'object', description: 'Config del nodo (opcional; default {}). Copia la forma de un nodo igual con ver_nodo.' },
                alias: { type: 'string', description: 'Nombre visible del nodo en el canvas (data.customName, opcional).' },
                posicion: { type: 'object', description: 'Posición {x, y} en el canvas (opcional; default aproximado).' }
            },
            required: ['flujoId', 'tipo']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            const tipo = String(args?.tipo || '').trim();
            if (!flujoId) throw new Error('Falta flujoId');
            if (!tipo) throw new Error('Falta tipo');
            if (!VALID_NODE_TYPES.has(tipo)) throw new Error(`Tipo de nodo inválido: "${tipo}". Revisa la lista de tipos válidos en la descripción.`);
            if (args?.data !== undefined && (typeof args.data !== 'object' || Array.isArray(args.data))) throw new Error('data debe ser un objeto');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? [...f.nodes] : [];

            const nodeId = `n_${Date.now()}_${randomBytes(3).toString('hex')}`;
            const pos = (args?.posicion && typeof args.posicion === 'object')
                ? { x: Number(args.posicion.x) || 0, y: Number(args.posicion.y) || 0 }
                : { x: 400, y: 160 + nodes.length * 40 };
            const data = { ...(args?.data || {}) };
            const alias = String(args?.alias || '').trim();
            if (alias) data.customName = alias;

            nodes.push({ id: nodeId, type: tipo, position: pos, data });
            const saved = await saveFlowNodes(req, redis, flujoId, nodes);
            return {
                flujoId,
                nodeId,
                tipo,
                creado: true,
                sinConectar: true,
                nota: 'El nodo quedó SIN conectar. Usa conectar_nodos para enlazarlo.',
                numNodosFlujo: Array.isArray(saved?.nodes) ? saved.nodes.length : nodes.length
            };
        }
    },

    editar_nodo: {
        description: 'Edita UN nodo existente sin reenviar el flujo completo. Por default FUSIONA (merge superficial) los campos de "data" que mandes con los que ya tiene (manda solo lo que cambias). Con reemplazarData=true sustituye TODA la data por la que mandes. También puedes cambiar posicion y alias (data.customName; alias="" lo quita). OJO: para arreglos dentro de data (p. ej. rutas, botones) el merge superficial REEMPLAZA el arreglo completo — manda el arreglo entero que quieras que quede. Para rutas de ubicación usa mejor editar_rutas_ubicacion.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                nodeId: { type: 'string', description: 'ID del nodo a editar.' },
                data: { type: 'object', description: 'Campos de data a cambiar (merge superficial por default).' },
                reemplazarData: { type: 'boolean', description: 'true = reemplazar TODA la data por "data" en vez de fusionar.' },
                alias: { type: 'string', description: 'Nombre visible (data.customName). "" lo quita (opcional).' },
                posicion: { type: 'object', description: 'Nueva posición {x, y} (opcional).' }
            },
            required: ['flujoId', 'nodeId']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            const nodeId = String(args?.nodeId || '').trim();
            if (!flujoId) throw new Error('Falta flujoId');
            if (!nodeId) throw new Error('Falta nodeId');
            if (args?.data !== undefined && (typeof args.data !== 'object' || Array.isArray(args.data))) throw new Error('data debe ser un objeto');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? [...f.nodes] : [];
            const idx = nodes.findIndex(n => n?.id === nodeId);
            if (idx === -1) throw new Error('Nodo no encontrado en ese flujo');

            let data;
            if (args?.reemplazarData === true) {
                data = { ...(args?.data || {}) };
            } else {
                data = { ...(nodes[idx].data || {}), ...(args?.data || {}) };
            }
            if (args?.alias !== undefined) {
                const alias = String(args.alias).trim();
                if (alias) data.customName = alias; else delete data.customName;
            }
            const next = { ...nodes[idx], data };
            if (args?.posicion && typeof args.posicion === 'object') {
                next.position = { x: Number(args.posicion.x) || 0, y: Number(args.posicion.y) || 0 };
            }
            nodes[idx] = next;
            const saved = await saveFlowNodes(req, redis, flujoId, nodes);
            return {
                flujoId,
                nodeId,
                tipo: next.type,
                guardado: true,
                nombre: nodeDisplayName(next),
                numNodosFlujo: Array.isArray(saved?.nodes) ? saved.nodes.length : nodes.length
            };
        }
    },

    eliminar_nodo: {
        description: 'Elimina UN nodo de un flujo y TODAS sus aristas (entrantes y salientes). No se puede deshacer. Devuelve cuántas aristas se quitaron. No borres el nodo raíz (inicio/inicio_lista/inicio_incompleto_silencio) salvo que vayas a reemplazarlo: un flujo sin raíz no corre.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                nodeId: { type: 'string', description: 'ID del nodo a eliminar.' }
            },
            required: ['flujoId', 'nodeId']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            const nodeId = String(args?.nodeId || '').trim();
            if (!flujoId) throw new Error('Falta flujoId');
            if (!nodeId) throw new Error('Falta nodeId');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? f.nodes : [];
            const edges = Array.isArray(f.edges) ? f.edges : [];
            const target = nodes.find(n => n?.id === nodeId);
            if (!target) throw new Error('Nodo no encontrado en ese flujo');
            const nuevosNodes = nodes.filter(n => n?.id !== nodeId);
            const nuevosEdges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);
            const saved = await saveFlowNodes(req, redis, flujoId, nuevosNodes, nuevosEdges);
            return {
                flujoId,
                nodeId,
                eliminado: true,
                tipoEliminado: target.type,
                aristasQuitadas: edges.length - nuevosEdges.length,
                numNodosFlujo: Array.isArray(saved?.nodes) ? saved.nodes.length : nuevosNodes.length
            };
        }
    },

    conectar_nodos: {
        description: 'Crea una arista (conexión) de un nodo origen a un nodo destino. "salida" es el sourceHandle: déjalo vacío para una salida normal; usa "si"/"no" para nodos de condición o de ubicación (rama Sí/No); para "Mandar Botones / Opciones" usa el id de la opción (el handle de ese botón, visible en ver_nodo de nodos conectados). Evita duplicar una arista idéntica. Devuelve el id de la arista creada.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                origen: { type: 'string', description: 'nodeId de origen (de donde sale la flecha).' },
                destino: { type: 'string', description: 'nodeId de destino (a donde llega).' },
                salida: { type: 'string', description: 'sourceHandle: vacío = normal; "si"/"no" = rama; id de opción para botones (opcional).' }
            },
            required: ['flujoId', 'origen', 'destino']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            const origen = String(args?.origen || '').trim();
            const destino = String(args?.destino || '').trim();
            const salida = args?.salida !== undefined && args.salida !== null && String(args.salida).trim() !== '' ? String(args.salida).trim() : null;
            if (!flujoId) throw new Error('Falta flujoId');
            if (!origen) throw new Error('Falta origen');
            if (!destino) throw new Error('Falta destino');
            if (origen === destino) throw new Error('Un nodo no se conecta consigo mismo');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? f.nodes : [];
            const edges = Array.isArray(f.edges) ? [...f.edges] : [];
            if (!nodes.some(n => n?.id === origen)) throw new Error('El nodo origen no existe en ese flujo');
            if (!nodes.some(n => n?.id === destino)) throw new Error('El nodo destino no existe en ese flujo');
            const dup = edges.find(e => e.source === origen && e.target === destino && (e.sourceHandle || null) === salida);
            if (dup) return { flujoId, aristaId: dup.id, origen, destino, salida, yaExistia: true };
            const edgeId = `e${Date.now()}_${randomBytes(2).toString('hex')}`;
            edges.push({ id: edgeId, source: origen, target: destino, sourceHandle: salida, targetHandle: null });
            const saved = await saveFlowNodes(req, redis, flujoId, nodes, edges);
            return {
                flujoId,
                aristaId: edgeId,
                origen,
                destino,
                salida,
                conectado: true,
                numAristasFlujo: Array.isArray(saved?.edges) ? saved.edges.length : edges.length
            };
        }
    },

    desconectar_nodos: {
        description: 'Quita una o varias aristas de un flujo. Pasa aristaId para quitar una específica, o bien origen+destino (y opcionalmente salida) para quitar la(s) que coincidan. Devuelve cuántas aristas se quitaron.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                aristaId: { type: 'string', description: 'ID de la arista a quitar (de ver_nodo). Alternativa a origen+destino.' },
                origen: { type: 'string', description: 'nodeId de origen (si no das aristaId).' },
                destino: { type: 'string', description: 'nodeId de destino (si no das aristaId).' },
                salida: { type: 'string', description: 'Filtrar por sourceHandle exacto (opcional; "si"/"no"/id de opción).' }
            },
            required: ['flujoId']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            if (!flujoId) throw new Error('Falta flujoId');
            const aristaId = String(args?.aristaId || '').trim();
            const origen = String(args?.origen || '').trim();
            const destino = String(args?.destino || '').trim();
            const tieneSalida = args?.salida !== undefined && args.salida !== null && String(args.salida).trim() !== '';
            const salida = tieneSalida ? String(args.salida).trim() : null;
            if (!aristaId && (!origen || !destino)) throw new Error('Da aristaId, o bien origen y destino');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? f.nodes : [];
            const edges = Array.isArray(f.edges) ? f.edges : [];
            const matches = (e) => aristaId
                ? e.id === aristaId
                : (e.source === origen && e.target === destino && (!tieneSalida || (e.sourceHandle || null) === salida));
            const nuevosEdges = edges.filter(e => !matches(e));
            const quitadas = edges.length - nuevosEdges.length;
            if (quitadas === 0) throw new Error('Ninguna arista coincidió');
            const saved = await saveFlowNodes(req, redis, flujoId, nodes, nuevosEdges);
            return {
                flujoId,
                aristasQuitadas: quitadas,
                numAristasFlujo: Array.isArray(saved?.edges) ? saved.edges.length : nuevosEdges.length
            };
        }
    },

    // ──────────────── NODO "PEDIR UBICACIÓN" (accion_ubicacion) ────────────────
    // Tools dedicadas para ver/crear/editar nodos de ubicación y sus RUTAS sin que
    // Grok tenga que reconstruir a mano el data.rutas[] completo (en METALSA son 49
    // rutas / 1060 paradas). Todas hacen read-modify-write contra el flujo y guardan
    // vía /api/flows (callInternal) → heredan auth SuperAdmin + side-effects. Para
    // ver lo que el nodo GENERA (qué candidatos compartieron ubicación, qué ruta les
    // quedó, distancia) están ver_ubicaciones_candidatos (agregado) y ver_ubicacion_candidato.

    ver_nodos_ubicacion: {
        description: 'Lista los nodos de "Pedir Ubicación" (accion_ubicacion). Sin flujoId: busca en TODOS los flujos. Con flujoId: solo ese flujo. Por cada nodo devuelve flujoId/flujoNombre, nodeId, alias (customName), el mensaje (body), radioMetros, timeout, y el resumen de cada ruta {nombre, numParadas, tieneMensaje, media}. Con detalle=true incluye las paradas completas (lat/lng) y el successMessage de cada ruta. Úsalo antes de editar para saber qué nodeId tocar.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo (opcional; si lo omites busca en todos).' },
                nodeId: { type: 'string', description: 'ID de un nodo concreto (opcional; requiere flujoId).' },
                detalle: { type: 'boolean', description: 'true = incluir paradas completas (lat/lng) y successMessage por ruta.' }
            }
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            const nodeIdFilter = String(args?.nodeId || '').trim();
            const detalle = args?.detalle === true;

            let flows = [];
            if (flujoId) {
                flows = [await fetchFlowOrThrow(req, redis, flujoId)];
            } else {
                const r = await callInternal(req, redis, '/api/flows', 'GET');
                if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al listar flujos (${r.status})`);
                const list = Array.isArray(r.data?.flows) ? r.data.flows : (Array.isArray(r.data) ? r.data : []);
                // El listado puede venir sin nodes completos; rehidratamos cada flujo.
                for (const f of list) {
                    const needHydrate = !Array.isArray(f.nodes);
                    flows.push(needHydrate ? await fetchFlowOrThrow(req, redis, f.id) : f);
                }
            }

            const nodos = [];
            for (const f of flows) {
                const nodes = Array.isArray(f.nodes) ? f.nodes : [];
                for (const n of nodes) {
                    if (n?.type !== 'accion_ubicacion') continue;
                    if (nodeIdFilter && n.id !== nodeIdFilter) continue;
                    const d = n.data || {};
                    const rutas = getNodeRutas(n);
                    const info = {
                        flujoId: f.id,
                        flujoNombre: f.name || null,
                        flujoActivo: !!f.active,
                        nodeId: n.id,
                        alias: (d.customName || '').trim() || null,
                        body: d.body || '',
                        radioMetros: Number(d.radioMetros) || 1000,
                        timeoutNever: d.timeoutNever !== false,
                        timeoutHoras: Number(d.timeoutHoras) || 48,
                        numRutas: rutas.length,
                        totalParadas: rutas.reduce((s, rt) => s + (Array.isArray(rt.paradas) ? rt.paradas.length : 0), 0),
                        rutas: detalle
                            ? rutas.map(rt => ({ nombre: rt.nombre || '', paradas: rt.paradas || [], successMessage: rt.successMessage || '', media: rt.mediaUrl ? { tipo: rt.mediaType || 'image', nombre: rt.mediaName || '', url: rt.mediaUrl } : null }))
                            : rutas.map(summarizeRuta)
                    };
                    nodos.push(info);
                }
            }
            return { total: nodos.length, nodos };
        }
    },

    crear_nodo_ubicacion: {
        description: 'Agrega un nodo "Pedir Ubicación" (accion_ubicacion) NUEVO a un flujo. SOLO inserta el nodo con su configuración y rutas; NO conecta las aristas Sí/No (eso lo haces después en el canvas o con guardar_flujo). Devuelve el nodeId nuevo. Parámetros: body (mensaje arriba del botón; default pre-cargado), radioMetros (100–5000, default 1000), timeoutNever (default true), rutas (opcional, mismo formato que editar_rutas_ubicacion). Consulta ver_catalogos_flujos no aplica aquí (las rutas son coordenadas libres). Para el JSON de rutas: una ruta = {nombre, paradas:[{nombre,lat,lng}], successMessage?, mediaUrl?, mediaType?, mediaName?}, grados decimales, lng negativa en México.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo donde insertar el nodo.' },
                body: { type: 'string', description: 'Mensaje arriba del botón nativo (≤1024). Si lo omites se usa el default.' },
                radioMetros: { type: 'number', description: 'Radio en metros para considerar "le queda cerca" (100–5000, default 1000).' },
                timeoutNever: { type: 'boolean', description: 'true (default) = la espera de ubicación no caduca. false = caduca a timeoutHoras.' },
                timeoutHoras: { type: 'number', description: 'Horas de ventana si timeoutNever=false (default 48).' },
                alias: { type: 'string', description: 'Nombre visible del nodo en el canvas (data.customName, opcional).' },
                posicion: { type: 'object', description: 'Posición en el canvas {x, y} (opcional; default aproximado).' },
                rutas: { type: 'array', items: { type: 'object' }, description: 'Rutas iniciales (opcional). Cada una: {nombre, paradas:[{nombre,lat,lng}], successMessage?, mediaUrl?, mediaType?, mediaName?}.' }
            },
            required: ['flujoId']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            if (!flujoId) throw new Error('Falta flujoId');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? [...f.nodes] : [];

            const rutasRaw = Array.isArray(args?.rutas) ? args.rutas : [];
            const rutas = rutasRaw.map((rt, i) => normalizeRuta(rt, i));

            let radio = Number(args?.radioMetros);
            if (!Number.isFinite(radio)) radio = 1000;
            radio = Math.max(100, Math.min(5000, radio));

            const nodeId = `n_${Date.now()}_${randomBytes(3).toString('hex')}`;
            const pos = (args?.posicion && typeof args.posicion === 'object')
                ? { x: Number(args.posicion.x) || 0, y: Number(args.posicion.y) || 0 }
                : { x: 400, y: 200 + nodes.length * 40 };

            const data = {
                body: args?.body !== undefined ? String(args.body) : UBICACION_DEFAULT_BODY,
                rutas,
                radioMetros: radio,
                timeoutHoras: Number(args?.timeoutHoras) || 48,
                timeoutNever: args?.timeoutNever !== false
            };
            const alias = String(args?.alias || '').trim();
            if (alias) data.customName = alias;

            nodes.push({ id: nodeId, type: 'accion_ubicacion', position: pos, data });
            const saved = await saveFlowNodes(req, redis, flujoId, nodes);
            return {
                flujoId,
                nodeId,
                creado: true,
                aristasSinConectar: true,
                nota: 'El nodo quedó SIN conectar (sin aristas de entrada ni salidas Sí/No). Conéctalo en el canvas o con guardar_flujo.',
                numRutas: rutas.length,
                numNodosFlujo: Array.isArray(saved?.nodes) ? saved.nodes.length : nodes.length
            };
        }
    },

    editar_nodo_ubicacion: {
        description: 'Edita la configuración GENERAL de un nodo de ubicación existente (NO sus rutas — para eso usa editar_rutas_ubicacion). Haz read-modify-write: solo manda los campos que quieras cambiar (body, radioMetros, timeoutNever, timeoutHoras, alias); el resto se conserva. Requiere flujoId + nodeId (de ver_nodos_ubicacion).',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                nodeId: { type: 'string', description: 'ID del nodo accion_ubicacion.' },
                body: { type: 'string', description: 'Nuevo mensaje arriba del botón (opcional).' },
                radioMetros: { type: 'number', description: 'Nuevo radio en metros 100–5000 (opcional).' },
                timeoutNever: { type: 'boolean', description: 'true = la espera no caduca; false = caduca (opcional).' },
                timeoutHoras: { type: 'number', description: 'Horas de ventana si timeoutNever=false (opcional).' },
                alias: { type: 'string', description: 'Nombre visible del nodo (data.customName). Cadena vacía lo quita (opcional).' }
            },
            required: ['flujoId', 'nodeId']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            const nodeId = String(args?.nodeId || '').trim();
            if (!flujoId) throw new Error('Falta flujoId');
            if (!nodeId) throw new Error('Falta nodeId');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? [...f.nodes] : [];
            const idx = nodes.findIndex(n => n?.id === nodeId);
            if (idx === -1) throw new Error('Nodo no encontrado en ese flujo');
            if (nodes[idx].type !== 'accion_ubicacion') throw new Error(`El nodo ${nodeId} no es de tipo "Pedir Ubicación"`);

            const data = { ...(nodes[idx].data || {}) };
            if (args?.body !== undefined) data.body = String(args.body);
            if (args?.radioMetros !== undefined) {
                let radio = Number(args.radioMetros);
                if (!Number.isFinite(radio)) throw new Error('radioMetros debe ser un número');
                data.radioMetros = Math.max(100, Math.min(5000, radio));
            }
            if (args?.timeoutNever !== undefined) {
                if (typeof args.timeoutNever !== 'boolean') throw new Error('timeoutNever debe ser true o false');
                data.timeoutNever = args.timeoutNever;
            }
            if (args?.timeoutHoras !== undefined) {
                const h = Number(args.timeoutHoras);
                if (!Number.isFinite(h) || h <= 0) throw new Error('timeoutHoras debe ser un número positivo');
                data.timeoutHoras = h;
            }
            if (args?.alias !== undefined) {
                const alias = String(args.alias).trim();
                if (alias) data.customName = alias; else delete data.customName;
            }

            nodes[idx] = { ...nodes[idx], data };
            const saved = await saveFlowNodes(req, redis, flujoId, nodes);
            return {
                flujoId,
                nodeId,
                guardado: true,
                config: {
                    body: data.body || '',
                    radioMetros: Number(data.radioMetros) || 1000,
                    timeoutNever: data.timeoutNever !== false,
                    timeoutHoras: Number(data.timeoutHoras) || 48,
                    alias: (data.customName || '').trim() || null,
                    numRutas: getNodeRutas(nodes[idx]).length
                },
                numNodosFlujo: Array.isArray(saved?.nodes) ? saved.nodes.length : nodes.length
            };
        }
    },

    editar_rutas_ubicacion: {
        description: 'Gestiona las RUTAS (data.rutas[]) de un nodo de ubicación. accion="reemplazar" sustituye TODO el arreglo de rutas por el que mandes; "agregar" añade rutas al final; "quitar" elimina rutas por nombre (nombres[]) o por índice 1-based (indices[]); "editar_ruta" fusiona cambios en UNA ruta existente (localizada por nombre o indice). Formato de cada ruta: {nombre, paradas:[{nombre,lat,lng}], successMessage?, mediaUrl?, mediaType?("image"|"document"), mediaName?}. Grados decimales, lng NEGATIVA en México. Si una ruta gana pero no tiene media/mensaje, el nodo no manda eso (nunca toma el de otra ruta). Devuelve el resumen de rutas resultante.',
        inputSchema: {
            type: 'object',
            properties: {
                flujoId: { type: 'string', description: 'ID del flujo.' },
                nodeId: { type: 'string', description: 'ID del nodo accion_ubicacion.' },
                accion: { type: 'string', enum: ['reemplazar', 'agregar', 'quitar', 'editar_ruta'], description: 'Operación sobre el arreglo de rutas.' },
                rutas: { type: 'array', items: { type: 'object' }, description: 'Rutas para "reemplazar" o "agregar". Cada una: {nombre, paradas:[{nombre,lat,lng}], successMessage?, mediaUrl?, mediaType?, mediaName?}.' },
                nombres: { type: 'array', items: { type: 'string' }, description: 'Para "quitar": nombres de ruta a eliminar.' },
                indices: { type: 'array', items: { type: 'number' }, description: 'Para "quitar": índices 1-based de ruta a eliminar.' },
                ruta: { type: 'object', description: 'Para "editar_ruta": campos a fusionar en la ruta localizada (puedes cambiar nombre, paradas, successMessage, media).' },
                nombreRuta: { type: 'string', description: 'Para "editar_ruta": nombre de la ruta a editar.' },
                indiceRuta: { type: 'number', description: 'Para "editar_ruta": índice 1-based de la ruta a editar (alternativa a nombreRuta).' }
            },
            required: ['flujoId', 'nodeId', 'accion']
        },
        handler: async (args, { redis, req }) => {
            const flujoId = String(args?.flujoId || '').trim();
            const nodeId = String(args?.nodeId || '').trim();
            const accion = String(args?.accion || '').trim();
            if (!flujoId) throw new Error('Falta flujoId');
            if (!nodeId) throw new Error('Falta nodeId');
            const f = await fetchFlowOrThrow(req, redis, flujoId);
            const nodes = Array.isArray(f.nodes) ? [...f.nodes] : [];
            const idx = nodes.findIndex(n => n?.id === nodeId);
            if (idx === -1) throw new Error('Nodo no encontrado en ese flujo');
            if (nodes[idx].type !== 'accion_ubicacion') throw new Error(`El nodo ${nodeId} no es de tipo "Pedir Ubicación"`);

            let rutas = getNodeRutas(nodes[idx]).map((rt, i) => normalizeRuta(rt, i));

            if (accion === 'reemplazar') {
                const nuevas = Array.isArray(args?.rutas) ? args.rutas : [];
                rutas = nuevas.map((rt, i) => normalizeRuta(rt, i));
            } else if (accion === 'agregar') {
                const nuevas = Array.isArray(args?.rutas) ? args.rutas : [];
                if (!nuevas.length) throw new Error('accion "agregar" requiere rutas[]');
                rutas = rutas.concat(nuevas.map((rt, i) => normalizeRuta(rt, i)));
            } else if (accion === 'quitar') {
                const nombres = (Array.isArray(args?.nombres) ? args.nombres : []).map(s => String(s).trim().toLowerCase()).filter(Boolean);
                const indices = (Array.isArray(args?.indices) ? args.indices : []).map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1);
                if (!nombres.length && !indices.length) throw new Error('accion "quitar" requiere nombres[] o indices[]');
                const idxSet = new Set(indices.map(n => n - 1));
                const antes = rutas.length;
                rutas = rutas.filter((rt, i) => !idxSet.has(i) && !nombres.includes(String(rt.nombre || '').trim().toLowerCase()));
                if (rutas.length === antes) throw new Error('Ninguna ruta coincidió con los nombres/índices dados');
            } else if (accion === 'editar_ruta') {
                const nombreRuta = String(args?.nombreRuta || '').trim().toLowerCase();
                const indiceRuta = Number(args?.indiceRuta);
                let target = -1;
                if (Number.isInteger(indiceRuta) && indiceRuta >= 1) target = indiceRuta - 1;
                else if (nombreRuta) target = rutas.findIndex(rt => String(rt.nombre || '').trim().toLowerCase() === nombreRuta);
                if (target < 0 || target >= rutas.length) throw new Error('No se encontró la ruta a editar (revisa nombreRuta/indiceRuta)');
                if (!args?.ruta || typeof args.ruta !== 'object') throw new Error('accion "editar_ruta" requiere el objeto "ruta" con los campos a cambiar');
                const merged = { ...rutas[target], ...args.ruta };
                rutas[target] = normalizeRuta(merged, target);
            } else {
                throw new Error('accion inválida (usa reemplazar, agregar, quitar o editar_ruta)');
            }

            const data = { ...(nodes[idx].data || {}), rutas };
            // Si existía el formato viejo data.paradas, lo quitamos para no confundir al motor.
            delete data.paradas;
            delete data.rutaNombre;
            nodes[idx] = { ...nodes[idx], data };
            const saved = await saveFlowNodes(req, redis, flujoId, nodes);
            return {
                flujoId,
                nodeId,
                accion,
                guardado: true,
                numRutas: rutas.length,
                totalParadas: rutas.reduce((s, rt) => s + rt.paradas.length, 0),
                rutas: rutas.map(summarizeRuta),
                numNodosFlujo: Array.isArray(saved?.nodes) ? saved.nodes.length : nodes.length
            };
        }
    },

    ver_ubicacion_candidato: {
        description: 'Devuelve la ubicación que un candidato compartió (snapshot que fijó el nodo "Pedir Ubicación"): ruta más cercana, parada, número de parada, metros y las coordenadas lat/lng. Barato (lee un solo candidato). Si el candidato nunca compartió ubicación, compartio=false. OJO: es un snapshot del momento; no se actualiza si editas las rutas después.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' }
            },
            required: ['candidateId']
        },
        handler: async (args) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const c = await getCandidateById(id);
            if (!c) throw new Error('Candidato no encontrado');
            const compartio = c.ubicacionLat !== undefined && c.ubicacionLat !== null && c.ubicacionLat !== '';
            return {
                candidateId: id,
                nombre: c.nombreReal || c.nombre || '',
                telefono: c.phone || c.telefono || '',
                compartio: !!compartio,
                rutaCercana: c.ubicacionRutaCercana || null,
                paradaCercana: c.ubicacionParadaCercana || null,
                numeroParada: c.ubicacionNumeroParada ?? null,
                metrosParada: c.ubicacionMetrosParada ?? null,
                lat: compartio ? Number(c.ubicacionLat) : null,
                lng: compartio ? Number(c.ubicacionLng) : null
            };
        }
    },

    ver_ubicaciones_candidatos: {
        description: 'AGREGADO de lo que genera el nodo "Pedir Ubicación" en toda la base: escanea candidatos (con TOPE por costo — NO está indexado) y devuelve cuántos compartieron ubicación, la distribución por ruta cercana, stats de distancia (min/mediana/máx), y una muestra de candidatos con sus datos. Filtra por "ruta" (nombre de ruta cercana) si quieres. Parámetros: limite (cuántos candidatos escanear, default 2000, máx 5000), muestra (cuántos candidatos devolver en la muestra, default 50). Para el detalle de uno usa ver_ubicacion_candidato.',
        inputSchema: {
            type: 'object',
            properties: {
                ruta: { type: 'string', description: 'Filtrar solo candidatos cuya ruta cercana sea esta (opcional).' },
                limite: { type: 'number', description: 'Cuántos candidatos escanear (default 2000, máx 5000). Más = más completo pero más caro.' },
                muestra: { type: 'number', description: 'Cuántos candidatos incluir en la muestra de salida (default 50, máx 300).' }
            }
        },
        handler: async (args) => {
            let limite = Number(args?.limite);
            if (!Number.isFinite(limite) || limite <= 0) limite = 2000;
            limite = Math.min(5000, Math.floor(limite));
            let muestraN = Number(args?.muestra);
            if (!Number.isFinite(muestraN) || muestraN <= 0) muestraN = 50;
            muestraN = Math.min(300, Math.floor(muestraN));
            const rutaFiltro = String(args?.ruta || '').trim().toLowerCase();

            const { candidates, total } = await getCandidates(limite);
            const lista = Array.isArray(candidates) ? candidates : [];

            const porRuta = {};
            const distancias = [];
            const muestra = [];
            let conUbicacion = 0;
            for (const c of lista) {
                const tiene = c.ubicacionLat !== undefined && c.ubicacionLat !== null && c.ubicacionLat !== '';
                if (!tiene) continue;
                const ruta = String(c.ubicacionRutaCercana || '').trim();
                if (rutaFiltro && ruta.toLowerCase() !== rutaFiltro) continue;
                conUbicacion++;
                const key = ruta || '(sin ruta)';
                porRuta[key] = (porRuta[key] || 0) + 1;
                const m = Number(c.ubicacionMetrosParada);
                if (Number.isFinite(m)) distancias.push(m);
                if (muestra.length < muestraN) {
                    muestra.push({
                        candidateId: c.id,
                        nombre: c.nombreReal || c.nombre || '',
                        telefono: c.phone || c.telefono || '',
                        rutaCercana: ruta || null,
                        paradaCercana: c.ubicacionParadaCercana || null,
                        numeroParada: c.ubicacionNumeroParada ?? null,
                        metrosParada: Number.isFinite(m) ? m : null,
                        lat: Number(c.ubicacionLat),
                        lng: Number(c.ubicacionLng)
                    });
                }
            }

            distancias.sort((a, b) => a - b);
            const mediana = distancias.length
                ? (distancias.length % 2
                    ? distancias[(distancias.length - 1) / 2]
                    : Math.round((distancias[distancias.length / 2 - 1] + distancias[distancias.length / 2]) / 2))
                : null;
            const rutasOrdenadas = Object.entries(porRuta)
                .map(([nombre, conteo]) => ({ ruta: nombre, conteo }))
                .sort((a, b) => b.conteo - a.conteo);

            return {
                escaneados: lista.length,
                totalEnBase: total,
                topeAlcanzado: lista.length >= limite && total > lista.length,
                conUbicacion,
                filtroRuta: rutaFiltro ? (args.ruta || '') : null,
                distribucionPorRuta: rutasOrdenadas,
                distanciaMetros: distancias.length
                    ? { min: distancias[0], mediana, max: distancias[distancias.length - 1] }
                    : null,
                muestra
            };
        }
    },

    // ──────────────── SECCIÓN MAPA (pines del dashboard) ────────────────
    // Lo que la sección "Mapa" del dashboard pinta, tal cual, SIN escanear los blobs
    // de candidatos. Dos capas, dos fuentes baratas:
    //   • Candidatos con ubicación → hash `candidatic:candidate_locations` (lo mantiene
    //     el webhook en cada ubicación entrante) + proyección facetada `candidate:facet:<id>`
    //     (etiquetas / categoría / asistencia), igual que /api/system/candidate-locations.
    //   • Pines propios (manuales, puestos por reclutadores: oficinas, puntos de entrevista,
    //     clientes) → hash `candidatic:map_pins`, igual que /api/system/map-pins.
    // OJO: distinto de ver_ubicacion(es)_candidato(s), que leen el snapshot de ruta del
    // nodo "Pedir Ubicación" desde el blob (más caro). Esto es la vista del Mapa.

    ver_mapa_candidatos: {
        description: 'La capa de CANDIDATOS de la sección Mapa: cada candidato que compartió su ubicación por WhatsApp (lo que pintan los pines verdes), leído barato del índice `candidatic:candidate_locations` + facetas (NO escanea blobs). Por pin devuelve candidateId, nombre, telefono, lat, lng, fecha, etiquetas, categoria y asistencia (confirmada true/false). Para CRUZAR info: filtra por etiqueta, categoria o soloAsistencia, busca por nombre/telefono (busqueda), o pasa cerca={lat,lng,radioKm} para traer SOLO los que caen dentro de ese radio de un punto (ej. un cliente o un pin propio), ordenados por distancia (devuelve distanciaMetros). Paginado con limit/offset. Respuesta: {total, conUbicacion, mostrados, hayMas, pins}.',
        inputSchema: {
            type: 'object',
            properties: {
                etiqueta: { type: 'string', description: 'Solo candidatos con esta etiqueta exacta (opcional).' },
                categoria: { type: 'string', description: 'Solo candidatos de esta categoría (opcional).' },
                soloAsistencia: { type: 'boolean', description: 'true = solo candidatos con asistencia confirmada (los puntos azules de "Ver asistencias").' },
                busqueda: { type: 'string', description: 'Texto para filtrar por nombre o teléfono (opcional).' },
                cerca: { type: 'object', description: 'Trae solo los pines dentro de un radio de un punto: {lat, lng, radioKm} (radioKm default 5). Ordena por cercanía y agrega distanciaMetros a cada pin.' },
                limit: { type: 'number', description: 'Cuántos por página (default 100, máx 500).' },
                offset: { type: 'number', description: 'Desde qué posición (default 0).' }
            }
        },
        handler: async (args, { redis }) => {
            const raw = await redis.hgetall('candidatic:candidate_locations');
            let pins = [];
            for (const [id, val] of Object.entries(raw || {})) {
                let p;
                try { p = JSON.parse(val); } catch { continue; }
                const lat = Number(p?.lat), lng = Number(p?.lng);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
                pins.push({ candidateId: id, nombre: p.nombre || '', telefono: p.whatsapp || '', lat, lng, fecha: p.ts || null, etiquetas: [], categoria: '', asistencia: false });
            }
            const totalConUbicacion = pins.length;

            // Enriquecer etiquetas/categoría/asistencia desde la facet (~277B c/u), igual que el Mapa.
            if (pins.length) {
                try {
                    const pipe = redis.pipeline();
                    for (const pin of pins) pipe.get(`candidate:facet:${pin.candidateId}`);
                    const results = await pipe.exec();
                    for (let i = 0; i < pins.length; i++) {
                        try {
                            const facetRaw = results?.[i]?.[1];
                            if (!facetRaw) continue;
                            const facet = JSON.parse(facetRaw);
                            if (Array.isArray(facet?.tags)) pins[i].etiquetas = facet.tags.map(t => typeof t === 'string' ? t : t?.name).filter(Boolean);
                            pins[i].asistencia = facet?.asistencia === true;
                            if (facet?.categoria) pins[i].categoria = String(facet.categoria);
                        } catch { /* pin sin facet → se queda sin enriquecer */ }
                    }
                } catch { /* si falla el pipeline, van sin facetas */ }
            }

            // Filtros (cruce de info).
            const etiqueta = String(args?.etiqueta || '').trim().toLowerCase();
            if (etiqueta) pins = pins.filter(p => p.etiquetas.some(t => String(t).trim().toLowerCase() === etiqueta));
            const categoria = String(args?.categoria || '').trim().toLowerCase();
            if (categoria) pins = pins.filter(p => String(p.categoria).trim().toLowerCase() === categoria);
            if (args?.soloAsistencia === true) pins = pins.filter(p => p.asistencia === true);
            const busqueda = String(args?.busqueda || '').trim().toLowerCase();
            if (busqueda) {
                const digits = busqueda.replace(/\D/g, '');
                pins = pins.filter(p => {
                    const byName = String(p.nombre).toLowerCase().includes(busqueda);
                    const byPhone = digits.length >= 3 && String(p.telefono).replace(/\D/g, '').includes(digits);
                    return byName || byPhone;
                });
            }

            // Proximidad a un punto (cruzar con un cliente / pin propio / coordenada).
            let ordenadoPorCercania = false;
            const cerca = args?.cerca;
            if (cerca && typeof cerca === 'object') {
                const cLat = Number(cerca.lat), cLng = Number(cerca.lng);
                if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) throw new Error('cerca requiere lat y lng numéricos');
                let radioKm = Number(cerca.radioKm);
                if (!Number.isFinite(radioKm) || radioKm <= 0) radioKm = 5;
                const radioM = radioKm * 1000;
                pins = pins
                    .map(p => ({ ...p, distanciaMetros: distanciaMetrosEntre(cLat, cLng, p.lat, p.lng) }))
                    .filter(p => p.distanciaMetros <= radioM)
                    .sort((a, b) => a.distanciaMetros - b.distanciaMetros);
                ordenadoPorCercania = true;
            }

            const totalFiltrado = pins.length;
            let limit = parseInt(args?.limit, 10);
            if (!Number.isFinite(limit) || limit <= 0) limit = 100;
            limit = Math.min(limit, ABS_MAX_PAGE);
            const offset = Math.max(parseInt(args?.offset, 10) || 0, 0);
            const page = pins.slice(offset, offset + limit);

            return {
                conUbicacion: totalConUbicacion,
                total: totalFiltrado,
                offset,
                mostrados: page.length,
                hayMas: offset + page.length < totalFiltrado,
                ordenadoPorCercania,
                pins: page
            };
        }
    },

    ver_pines_mapa: {
        description: 'La capa de PINES PROPIOS de la sección Mapa: los marcadores que los reclutadores pusieron a mano (oficinas, puntos de entrevista, clientes), leídos del hash `candidatic:map_pins`. Por pin devuelve id, label (nombre), note (nota), color, lat, lng, tieneLogo, createdBy y fecha. Para CRUZAR info geográfica (ej. candidatos cerca de un cliente) toma el lat/lng de un pin de aquí y pásalo a ver_mapa_candidatos con cerca={lat,lng,radioKm}. Respuesta: {total, pins}.',
        inputSchema: {
            type: 'object',
            properties: {
                busqueda: { type: 'string', description: 'Texto para filtrar por nombre (label) o nota (opcional).' }
            }
        },
        handler: async (args, { redis }) => {
            const rawAll = await redis.hgetall('candidatic:map_pins');
            let pins = [];
            for (const [id, val] of Object.entries(rawAll || {})) {
                let p;
                try { p = typeof val === 'string' ? JSON.parse(val) : val; } catch { continue; }
                const lat = Number(p?.lat), lng = Number(p?.lng);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
                pins.push({
                    id,
                    label: typeof p.label === 'string' ? p.label : '',
                    note: typeof p.note === 'string' ? p.note : '',
                    color: p.color || 'blue',
                    lat, lng,
                    tieneLogo: typeof p.logo === 'string' && p.logo.startsWith('data:image/'),
                    createdBy: p.createdBy || '',
                    fecha: p.ts || null
                });
            }
            const busqueda = String(args?.busqueda || '').trim().toLowerCase();
            if (busqueda) pins = pins.filter(p => p.label.toLowerCase().includes(busqueda) || p.note.toLowerCase().includes(busqueda));
            pins.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
            return { total: pins.length, pins };
        }
    },

    ver_paradas_transporte: {
        description: 'Las paradas de transporte público que pinta la sección Mapa (datos de referencia estáticos, NO de Redis): estaciones del Metro de Monterrey (Metrorrey) por línea (L1 amarilla, L2 verde, L3 roja; las de transbordo llevan transbordo:true) y las paradas del corredor Ecovía. Cada parada: nombre, lat, lng. Para CRUZAR info geográfica pasa cerca={lat,lng,radioKm} (radioKm default 1) y devuelve solo las paradas dentro de ese radio del punto, ordenadas por cercanía con distanciaMetros (ej. "¿qué candidato vive cerca de una estación del Metro?" → toma el lat/lng del candidato de ver_mapa_candidatos y pásalo aquí). transporte="metro" | "ecovia" | "ambos" (default) acota la capa.',
        inputSchema: {
            type: 'object',
            properties: {
                transporte: { type: 'string', enum: ['metro', 'ecovia', 'ambos'], description: 'Qué capa devolver (default "ambos").' },
                cerca: { type: 'object', description: 'Trae solo las paradas dentro de un radio de un punto: {lat, lng, radioKm} (radioKm default 1). Ordena por cercanía y agrega distanciaMetros.' }
            }
        },
        handler: async (args) => {
            const cual = ['metro', 'ecovia'].includes(args?.transporte) ? args.transporte : 'ambos';

            // Aplana todas las paradas con su etiqueta de capa/línea.
            const todas = [];
            if (cual === 'metro' || cual === 'ambos') {
                for (const line of (METRO_LINES || [])) {
                    for (const s of (line.stops || [])) {
                        todas.push({ transporte: 'metro', linea: line.nombre || line.id || '', color: line.color || null, nombre: s.nombre || '', lat: Number(s.lat), lng: Number(s.lng), transbordo: s.transfer === true });
                    }
                }
            }
            if (cual === 'ecovia' || cual === 'ambos') {
                for (const s of (ECOVIA_STOPS || [])) {
                    todas.push({ transporte: 'ecovia', linea: 'Ecovía', color: null, nombre: s.nombre || '', lat: Number(s.lat), lng: Number(s.lng), transbordo: false });
                }
            }

            // Proximidad a un punto (cruzar con la ubicación de un candidato / pin / coordenada).
            const cerca = args?.cerca;
            if (cerca && typeof cerca === 'object') {
                const cLat = Number(cerca.lat), cLng = Number(cerca.lng);
                if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) throw new Error('cerca requiere lat y lng numéricos');
                let radioKm = Number(cerca.radioKm);
                if (!Number.isFinite(radioKm) || radioKm <= 0) radioKm = 1;
                const radioM = radioKm * 1000;
                const cercanas = todas
                    .map(s => ({ ...s, distanciaMetros: distanciaMetrosEntre(cLat, cLng, s.lat, s.lng) }))
                    .filter(s => s.distanciaMetros <= radioM)
                    .sort((a, b) => a.distanciaMetros - b.distanciaMetros);
                return { modo: 'cerca', transporte: cual, radioKm, total: cercanas.length, paradas: cercanas };
            }

            // Sin proximidad: devuelve la estructura completa (Metro por línea + Ecovía plano).
            const metro = (cual === 'metro' || cual === 'ambos')
                ? (METRO_LINES || []).map(l => ({ id: l.id, nombre: l.nombre, color: l.color, numEstaciones: (l.stops || []).length, estaciones: (l.stops || []).map(s => ({ nombre: s.nombre, lat: Number(s.lat), lng: Number(s.lng), transbordo: s.transfer === true })) }))
                : undefined;
            const ecovia = (cual === 'ecovia' || cual === 'ambos')
                ? (ECOVIA_STOPS || []).map(s => ({ nombre: s.nombre, lat: Number(s.lat), lng: Number(s.lng) }))
                : undefined;
            return {
                transporte: cual,
                totalParadas: todas.length,
                ...(metro ? { metro: { numLineas: metro.length, lineas: metro } } : {}),
                ...(ecovia ? { ecovia: { numParadas: ecovia.length, paradas: ecovia } } : {})
            };
        }
    },

    // ──────────────── ESTADÍSTICAS DE ANUNCIOS (Ads) ────────────────
    // Acceso completo a la sección de Estadísticas de Anuncios. Todo pasa por los
    // endpoints reales (/api/ads-stats, /api/ad-labels, /api/ads-comments) vía
    // callInternal, así hereda la auth y los side-effects (caché Meta, índices,
    // aplicación de etiquetas a candidatos). No reimplementa nada.

    ver_estadisticas_ads: {
        description: 'Métricas de TODOS los anuncios (CTWA) del dashboard de Estadísticas de Anuncios: leads que trajo cada uno, calificados, estado en Meta e insights (impresiones, clics, gasto, CTR, CPC, conversaciones, costo por conversación). rango="all" (histórico) | "today" | "7d" | "30d". incluirArchivados=true agrega los anuncios archivados (marcados archivado:true). Usa el adId para archivar/etiquetar/ver comentarios de un anuncio.',
        inputSchema: {
            type: 'object',
            properties: {
                rango: { type: 'string', enum: ['all', 'today', '7d', '30d'], description: 'Ventana de tiempo (default "all" = histórico).' },
                incluirArchivados: { type: 'boolean', description: 'true = incluir también los anuncios archivados.' }
            }
        },
        handler: async (args, { redis, req }) => {
            const rango = ['today', '7d', '30d'].includes(args?.rango) ? args.rango : 'all';
            const incluir = args?.incluirArchivados === true;
            const qs = `range=${rango}${incluir ? '&includeArchived=true' : ''}`;
            const r = await callInternal(req, redis, `/api/ads-stats?${qs}`, 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer estadísticas de anuncios (${r.status})`);
            const ads = Array.isArray(r.data?.ads) ? r.data.ads : [];
            // Compacto: solo lo útil para analizar. Se omiten imagen/video/body/url (pesados).
            return {
                rango: r.data?.range || rango,
                totalLeadsDeAnuncios: r.data?.totalAdsLeads || 0,
                numAnuncios: ads.length,
                datoCacheado: r.data?.stale === true,
                anuncios: ads.map(a => ({
                    adId: a.adId || null,
                    nombre: a.adName || a.adHeadline || 'Anuncio sin título',
                    estadoMeta: a.effectiveStatus || null,
                    leads: a.totalLeads || 0,
                    leadsHoy: a.todayLeads || 0,
                    calificados: a.completeLeads || 0,
                    impresiones: a.impressions || null,
                    clics: a.clicks || null,
                    gasto: a.spend || null,
                    ctr: a.ctr || null,
                    cpc: a.cpc || null,
                    cpm: a.cpm || null,
                    alcance: a.reach || null,
                    frecuencia: a.frequency || null,
                    conversaciones: a.messagingConnections || null,
                    primerasRespuestas: a.messagingReplies || null,
                    costoPorConversacion: a.costPerConversation || null,
                    primerLead: a.firstSeen || null,
                    ultimoLead: a.lastSeen || null,
                    archivado: a.archived === true
                }))
            };
        }
    },

    archivar_ad: {
        description: 'Archiva un anuncio del dashboard de Estadísticas (lo saca del listado y lo resta del total de leads). Es reversible con restaurar_ad. Pasa el adId (de ver_estadisticas_ads).',
        inputSchema: {
            type: 'object',
            properties: { adId: { type: 'string', description: 'ID del anuncio a archivar.' } },
            required: ['adId']
        },
        handler: async (args, { redis, req }) => {
            const adKey = String(args?.adId || '').trim();
            if (!adKey) throw new Error('Falta adId');
            const r = await callInternal(req, redis, '/api/ads-stats', 'DELETE', { adKey });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al archivar el anuncio (${r.status})`);
            return { adId: adKey, archivado: true };
        }
    },

    restaurar_ad: {
        description: 'Restaura (desarchiva) un anuncio previamente archivado para que vuelva a aparecer en el dashboard de Estadísticas. Pasa el adId.',
        inputSchema: {
            type: 'object',
            properties: { adId: { type: 'string', description: 'ID del anuncio a restaurar.' } },
            required: ['adId']
        },
        handler: async (args, { redis, req }) => {
            const adKey = String(args?.adId || '').trim();
            if (!adKey) throw new Error('Falta adId');
            const r = await callInternal(req, redis, '/api/ads-stats', 'DELETE', { adKey, restore: true });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al restaurar el anuncio (${r.status})`);
            return { adId: adKey, archivado: false };
        }
    },

    listar_etiquetas_ads: {
        description: 'Lista las etiquetas de anuncio (ad-labels): cada una agrupa uno o varios adIds bajo una etiqueta con nombre/emoji/color que se aplica automáticamente a los candidatos que vienen de esos anuncios. Devuelve id, nombre, adIds, color y empresa.',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis, req }) => {
            const r = await callInternal(req, redis, '/api/ad-labels', 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al listar etiquetas de anuncio (${r.status})`);
            const labels = Array.isArray(r.data?.labels) ? r.data.labels : [];
            return {
                total: labels.length,
                etiquetas: labels.map(l => ({
                    id: l.id,
                    nombre: l.tagName || null,
                    emoji: l.emoji || '',
                    color: l.color || null,
                    empresa: l.company || '',
                    adIds: Array.isArray(l.adIds) ? l.adIds : (l.adId ? [l.adId] : [])
                }))
            };
        }
    },

    crear_etiqueta_ad: {
        description: 'Crea una etiqueta de anuncio y la aplica a los candidatos que vinieron de esos anuncios. nombre obligatorio; adIds = uno o varios IDs de anuncio (array o string con comas). emoji/color/empresa opcionales. Devuelve cuántos candidatos quedaron etiquetados (aplicados).',
        inputSchema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre de la etiqueta.' },
                adIds: { type: 'array', items: { type: 'string' }, description: 'IDs de anuncio a cubrir (al menos uno).' },
                emoji: { type: 'string', description: 'Emoji opcional (se antepone al nombre).' },
                color: { type: 'string', description: 'Color hex opcional (default #a855f7).' },
                empresa: { type: 'string', description: 'Empresa opcional.' }
            },
            required: ['nombre', 'adIds']
        },
        handler: async (args, { redis, req }) => {
            const nombre = String(args?.nombre || '').trim();
            if (!nombre) throw new Error('Falta el nombre de la etiqueta');
            const adIds = Array.isArray(args?.adIds) ? args.adIds.map(x => String(x).trim()).filter(Boolean) : [];
            if (!adIds.length) throw new Error('Falta al menos un adId');
            const r = await callInternal(req, redis, '/api/ad-labels', 'POST', {
                name: nombre, adIds: adIds.join(','), emoji: args?.emoji || '', color: args?.color || '', company: args?.empresa || ''
            });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al crear la etiqueta (${r.status})`);
            return { creada: true, id: r.data?.label?.id, nombre: r.data?.label?.tagName, candidatosEtiquetados: r.data?.applied || 0 };
        }
    },

    editar_etiqueta_ad: {
        description: 'Edita una etiqueta de anuncio existente (de listar_etiquetas_ads): cambia nombre/emoji/color/empresa y/o el conjunto de adIds. Si cambia el nombre, se renombra en todos los candidatos que la tenían; si se agregan adIds nuevos, se aplica a esos candidatos. Debes mandar el conjunto COMPLETO de adIds que quieres que quede.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'ID de la etiqueta (de listar_etiquetas_ads).' },
                nombre: { type: 'string', description: 'Nombre (obligatorio).' },
                adIds: { type: 'array', items: { type: 'string' }, description: 'Conjunto COMPLETO de adIds que debe quedar (al menos uno).' },
                emoji: { type: 'string', description: 'Emoji opcional.' },
                color: { type: 'string', description: 'Color hex opcional.' },
                empresa: { type: 'string', description: 'Empresa opcional.' }
            },
            required: ['id', 'nombre', 'adIds']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.id || '').trim();
            const nombre = String(args?.nombre || '').trim();
            if (!id) throw new Error('Falta id');
            if (!nombre) throw new Error('Falta el nombre');
            const adIds = Array.isArray(args?.adIds) ? args.adIds.map(x => String(x).trim()).filter(Boolean) : [];
            if (!adIds.length) throw new Error('Falta al menos un adId');
            const r = await callInternal(req, redis, '/api/ad-labels', 'PUT', {
                id, name: nombre, adIds: adIds.join(','), emoji: args?.emoji || '', color: args?.color || '', company: args?.empresa || ''
            });
            if (r.status === 404) throw new Error('Etiqueta no encontrada');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al editar la etiqueta (${r.status})`);
            return { editada: true, id, nombre: r.data?.label?.tagName, nombreAnterior: r.data?.oldTagName || null, candidatosRenombrados: r.data?.renamed || 0 };
        }
    },

    borrar_etiqueta_ad: {
        description: 'Borra una etiqueta de anuncio (de listar_etiquetas_ads) en profundidad: la quita del catálogo global y de todos los candidatos que la tenían. Devuelve de cuántos candidatos se quitó.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'ID de la etiqueta a borrar.' } },
            required: ['id']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.id || '').trim();
            if (!id) throw new Error('Falta id');
            const r = await callInternal(req, redis, `/api/ad-labels?id=${encodeURIComponent(id)}`, 'DELETE');
            if (r.status === 404) throw new Error('Etiqueta no encontrada');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al borrar la etiqueta (${r.status})`);
            return { borrada: true, id, nombre: r.data?.removed?.tagName || null, candidatosAfectados: r.data?.removedFrom || 0 };
        }
    },

    ver_comentarios_ad: {
        description: 'Comentarios de Facebook del post vinculado a un anuncio: mensaje, autor, fecha, likes y respuestas anidadas. Pasa el adId (de ver_estadisticas_ads). Usa responder_comentario_ad para contestar uno.',
        inputSchema: {
            type: 'object',
            properties: { adId: { type: 'string', description: 'ID del anuncio.' } },
            required: ['adId']
        },
        handler: async (args, { redis, req }) => {
            const adId = String(args?.adId || '').trim();
            if (!adId) throw new Error('Falta adId');
            const r = await callInternal(req, redis, `/api/ads-comments?adId=${encodeURIComponent(adId)}`, 'GET');
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al leer comentarios (${r.status})`);
            const comments = Array.isArray(r.data?.comments) ? r.data.comments : [];
            return {
                adId,
                postId: r.data?.postId || null,
                totalComentarios: r.data?.totalComments || comments.length,
                comentarios: comments.map(c => ({
                    id: c.id,
                    mensaje: c.message || '',
                    autor: c.from?.name || 'Usuario',
                    fecha: c.createdTime || null,
                    likes: c.likeCount || 0,
                    respuestas: (c.replies || []).map(rp => ({
                        id: rp.id, mensaje: rp.message || '', autor: rp.from?.name || 'Usuario', fecha: rp.createdTime || null
                    }))
                }))
            };
        }
    },

    responder_comentario_ad: {
        description: 'Responde públicamente a un comentario de Facebook de un anuncio (desde la Página). Pasa el commentId (de ver_comentarios_ad), el mensaje y opcionalmente el adId para refrescar su caché de comentarios.',
        inputSchema: {
            type: 'object',
            properties: {
                commentId: { type: 'string', description: 'ID del comentario a responder (de ver_comentarios_ad).' },
                mensaje: { type: 'string', description: 'Texto de la respuesta.' },
                adId: { type: 'string', description: 'ID del anuncio (opcional, para invalidar su caché de comentarios).' }
            },
            required: ['commentId', 'mensaje']
        },
        handler: async (args, { redis, req }) => {
            const commentId = String(args?.commentId || '').trim();
            const mensaje = String(args?.mensaje || '').trim();
            if (!commentId) throw new Error('Falta commentId');
            if (!mensaje) throw new Error('Falta el mensaje');
            const r = await callInternal(req, redis, '/api/ads-comments', 'POST', { commentId, message: mensaje, adId: args?.adId ? String(args.adId).trim() : undefined });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al responder el comentario (${r.status})`);
            return { respondido: true, commentId, replyId: r.data?.replyId || null };
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC
// ─────────────────────────────────────────────────────────────────────────────
function rpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolList() {
    return Object.entries(TOOLS).map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: def.inputSchema
    }));
}

async function handleRpc(msg, ctx) {
    // Notificaciones (sin id) → no llevan respuesta JSON-RPC.
    const isNotification = msg == null || msg.id === undefined || msg.id === null;
    const id = isNotification ? null : msg.id;
    const method = msg?.method;

    if (method === 'initialize') {
        const requested = msg?.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : PREFERRED_PROTOCOL_VERSION;
        return rpcResult(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO
        });
    }

    if (method === 'ping') return rpcResult(id, {});

    // Notificaciones del ciclo de vida (initialized, cancelled, etc.)
    if (isNotification || String(method || '').startsWith('notifications/')) {
        return null; // se contesta 202 sin cuerpo
    }

    if (method === 'tools/list') {
        return rpcResult(id, { tools: toolList() });
    }

    if (method === 'tools/call') {
        const name = msg?.params?.name;
        const def = TOOLS[name];
        if (!def) return rpcError(id, -32602, `Tool desconocida: ${name}`);
        try {
            const value = await def.handler(msg?.params?.arguments || {}, ctx);
            return rpcResult(id, {
                content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
            });
        } catch (e) {
            // Error de ejecución de tool: se reporta DENTRO del result con isError.
            return rpcResult(id, {
                content: [{ type: 'text', text: `Error: ${e.message}` }],
                isError: true
            });
        }
    }

    return rpcError(id, -32601, `Método no soportado: ${method}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler HTTP
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    // Los headers CORS los agrega vercel.json a nivel plataforma para /api/(.*),
    // así que aquí NO los repetimos (evita ACAO duplicado). Grok llama server-to-server.
    if (req.method === 'OPTIONS') return res.status(200).end();

    // El transporte Streamable HTTP admite GET para abrir un stream SSE; este
    // servidor es stateless y no ofrece stream saliente → 405 (permitido por la spec).
    if (req.method === 'GET') {
        return res.status(405).json({ error: 'Este MCP es stateless; usa POST.' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Redis no disponible' });

    // ── Auth: Bearer contra mcp:token ──
    const presented = extractBearer(req);
    const expected = await redis.get('mcp:token');
    if (!expected || !presented || !safeEqual(presented, expected)) {
        logMcp(redis, req, { status: 401, reason: 'auth_fail', hasAuth: !!presented, hasTokenConfigured: !!expected });
        return res.status(401).json({ error: 'No autorizado' });
    }

    // ── Kill switch ──
    if (!(await isEnabled(redis))) {
        logMcp(redis, req, { status: 403, reason: 'disabled' });
        return res.status(403).json({ error: 'El MCP está apagado en Candidatic.' });
    }

    // ── Body (Vercel ya parsea application/json; toleramos string) ──
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json(rpcError(null, -32700, 'JSON inválido')); }
    }

    const ctx = { redis, req };

    // Resumen del/los método(s) para el log de diagnóstico.
    const methods = Array.isArray(body)
        ? body.map(m => m?.method).filter(Boolean).join(',')
        : (body?.method || '?');
    const toolName = !Array.isArray(body) && body?.method === 'tools/call' ? body?.params?.name : undefined;

    try {
        // Soporta un mensaje suelto o un arreglo (batch de clientes viejos).
        if (Array.isArray(body)) {
            const out = [];
            for (const msg of body) {
                const r = await handleRpc(msg, ctx);
                if (r) out.push(r);
            }
            logMcp(redis, req, { status: out.length ? 200 : 202, reason: 'ok', method: methods });
            if (!out.length) return res.status(202).end();
            return res.status(200).json(out);
        }

        const result = await handleRpc(body, ctx);
        logMcp(redis, req, { status: result ? 200 : 202, reason: 'ok', method: methods, tool: toolName });
        if (!result) return res.status(202).end(); // fue una notificación
        return res.status(200).json(result);
    } catch (e) {
        logMcp(redis, req, { status: 500, reason: 'error', method: methods, error: e.message });
        return res.status(200).json(rpcError(body?.id ?? null, -32603, `Error interno: ${e.message}`));
    }
}
