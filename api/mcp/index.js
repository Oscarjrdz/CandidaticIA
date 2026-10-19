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
 * Tools: lectura + escritura de Chat Web, analítica, CRM Manual (Proyectos) y la
 * sección completa de Flujos (ver/crear/editar/borrar flujos y nodos + métricas y
 * ejecución). Las de escritura llaman a los endpoints reales vía callInternal.
 * Plan y lista completa de tools: docs/mcp-grok-plan.md
 */

import { randomBytes } from 'crypto';
import {
    getRedisClient,
    getCandidates,
    getCandidateById,
    getMessages,
    getVacancies,
    getExpediente,
    getUsers
} from '../utils/storage.js';
import { substituteVariables, substituteDynamicPhrase } from '../utils/shortcuts.js';
import { getFilterCountsWithIndex, countSegment, resolveSegmentIds } from '../utils/facet-index.js';

const SERVER_INFO = { name: 'candidatic-chatweb', version: '1.0.0' };
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
                creado: c.createdAt || null
            };
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
        description: 'Lista las vacantes disponibles en la plataforma.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
            const vacancies = await getVacancies();
            return {
                vacantes: (Array.isArray(vacancies) ? vacancies : []).map(v => ({
                    id: v.id,
                    titulo: v.titulo || v.nombre || v.name || null,
                    categoria: v.categoria || null,
                    activa: v.activa !== undefined ? v.activa : (v.active !== undefined ? v.active : null)
                }))
            };
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
        description: 'Lista TODOS los flujos (resumen). Devuelve id, nombre, si está activo, cuántos nodos/aristas tiene, los tipos de nodo crudos y "nombresDeNodos" (los nombres visibles de cada nodo, tal como los ve el reclutador en el canvas). Usa ver_flujo para traer los nodos completos de uno.',
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
                tipoRaiz: { type: 'string', enum: ['estandar', 'lista', 'incompletos'], description: 'Tipo de nodo raíz (default "estandar").' }
            },
            required: ['nombre']
        },
        handler: async (args, { redis, req }) => {
            const nombre = String(args?.nombre || '').trim();
            if (!nombre) throw new Error('Falta el nombre del flujo');
            const rootType = args?.tipoRaiz === 'lista' ? 'lista' : args?.tipoRaiz === 'incompletos' ? 'incompletos' : 'estandar';
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
