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
 * FASE 1 = SOLO LECTURA (14 tools). Las de escritura se agregan después.
 * Plan completo: docs/mcp-grok-plan.md
 */

import { randomBytes } from 'crypto';
import {
    getRedisClient,
    getCandidates,
    getCandidateById,
    getMessages,
    getVacancies,
    getExpediente
} from '../utils/storage.js';
import { substituteVariables, substituteDynamicPhrase } from '../utils/shortcuts.js';

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
async function callInternal(req, redis, path, method, body) {
    const token = `mcpsys_${randomBytes(24).toString('hex')}`;
    const sessionKey = `session:admin:${token}`;
    const expiresAt = new Date(Date.now() + 120000).toISOString();
    await redis.set(sessionKey, JSON.stringify({ userId: 'mcp-grok', userName: 'Grok (IA)', expiresAt }), 'EX', 120);

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

// ─────────────────────────────────────────────────────────────────────────────
// Registro de TOOLS (Fase 1: solo lectura)
// Cada tool: { description, inputSchema, handler(args, { redis }) -> any }
// El valor que regrese el handler se serializa a JSON dentro de un content text.
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = {
    listar_chats: {
        description: 'Lista los chats/candidatos del Chat Web (nombre, teléfono, etiquetas, si tiene mensajes no leídos y su vacante). Úsalo para ver la bandeja. Devuelve un resumen, no el historial.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Cuántos chats traer (máx 50). Default 30.' },
                busqueda: { type: 'string', description: 'Texto para filtrar por nombre o teléfono.' },
                etiqueta: { type: 'string', description: 'Filtrar por una etiqueta exacta.' },
                soloNoLeidos: { type: 'boolean', description: 'Si es true, solo chats con mensajes no leídos.' }
            }
        },
        handler: async (args) => {
            const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 30, 1), 50);
            const busqueda = String(args?.busqueda || '');
            const etiqueta = String(args?.etiqueta || '');
            const { candidates, total } = await getCandidates(limit, 0, busqueda, false, etiqueta);
            let chats = (candidates || []).map(summarizeChat);
            if (args?.soloNoLeidos) chats = chats.filter(c => c.noLeido);
            return { total, mostrados: chats.length, chats };
        }
    },

    leer_chat: {
        description: 'Lee el historial de mensajes de un chat (candidato). Devuelve los mensajes recientes con quién los mandó, texto, tipo, fecha y estado de entrega.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato (de listar_chats o buscar_candidato).' },
                limit: { type: 'number', description: 'Cuántos mensajes recientes (máx 100). Default 30.' }
            },
            required: ['candidateId']
        },
        handler: async (args) => {
            const id = String(args?.candidateId || '').trim();
            if (!id) throw new Error('Falta candidateId');
            const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 30, 1), 100);
            const msgs = await getMessages(id, limit);
            return (msgs || []).map(m => ({
                de: m.from === 'me' ? 'reclutador' : (m.from === 'bot' ? 'brenda' : 'candidato'),
                texto: m.content || '',
                tipo: m.type || 'text',
                fecha: m.timestamp || m.fecha || null,
                estado: m.status || null
            }));
        }
    },

    buscar_candidato: {
        description: 'Busca candidatos por nombre o teléfono. Devuelve coincidencias con su candidateId para luego leer o actuar sobre ellas.',
        inputSchema: {
            type: 'object',
            properties: {
                texto: { type: 'string', description: 'Nombre o teléfono a buscar.' },
                limit: { type: 'number', description: 'Máximo de resultados (máx 20). Default 10.' }
            },
            required: ['texto']
        },
        handler: async (args) => {
            const texto = String(args?.texto || '').trim();
            if (!texto) throw new Error('Falta el texto de búsqueda');
            const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 10, 1), 20);
            const { candidates, total } = await getCandidates(limit, 0, texto);
            return { total, resultados: (candidates || []).map(summarizeChat) };
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
        description: 'Lista las plantillas de mensaje configuradas (las que se usan para recordatorios y envíos oficiales).',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_args, { redis }) => {
            const raw = await redis.get('candidatic:reminder_templates');
            const templates = raw ? JSON.parse(raw) : [];
            return {
                plantillas: (Array.isArray(templates) ? templates : []).map(t => ({
                    id: t.id || t.name || null,
                    nombre: t.name || t.displayName || null,
                    idioma: t.language || t.lang || null
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
        description: 'Envía un mensaje de texto al candidato por WhatsApp, como lo haría un reclutador. El mensaje admite variables de plantilla ({{nombre}}, etc.), que se resuelven en el servidor.',
        inputSchema: {
            type: 'object',
            properties: {
                candidateId: { type: 'string', description: 'ID del candidato.' },
                texto: { type: 'string', description: 'Texto a enviar.' }
            },
            required: ['candidateId', 'texto']
        },
        handler: async (args, { redis, req }) => {
            const id = String(args?.candidateId || '').trim();
            const texto = String(args?.texto || '').trim();
            if (!id) throw new Error('Falta candidateId');
            if (!texto) throw new Error('Falta el texto del mensaje');
            const r = await callInternal(req, redis, '/api/chat', 'POST', {
                candidateId: id, message: texto, type: 'text', senderId: 'mcp-grok', senderName: 'Grok (IA)'
            });
            if (!r.ok || r.data?.success === false) throw new Error(r.data?.error || `Fallo al enviar (${r.status})`);
            const estado = r.data?.message?.status || 'enviado';
            if (estado === 'failed') throw new Error(r.data?.message?.error || 'El envío falló en Meta');
            return { candidateId: id, enviado: true, estado };
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
