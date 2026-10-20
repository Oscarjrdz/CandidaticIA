/**
 * grok-event.js — Envío de eventos a Grok (xAI) para seguimiento autónomo.
 *
 * Flujo del evento "candidato inactivo 1h":
 *   cron (gate barato en Redis) → buildInactivityPayload() → sendInactivityEventToGrok()
 *   → Grok decide (mandar WhatsApp / meter a un flow / etiquetar / no hacer nada)
 *   usando las tools del MCP de Candidatic (xAI las ejecuta server-to-server).
 *
 * Diseño enfocado en AHORRO DE TOKENS (según docs oficiales de xAI):
 *   - Modelo barato por default (grok-4.3) — configurable en grok:seguimiento:settings.
 *   - allowed_tools acotado (8 tools, no las ~45) → menos contexto de manifiesto por llamada.
 *     Doc: "Reduce context overhead by limiting tool definitions the model needs to consider".
 *   - System prompt FIJO al inicio (prefijo estable) + header x-grok-conv-id por candidato
 *     → prompt caching automático de xAI (cached input se cobra ~4x más barato).
 *   - Payload PRE-CARGADO (perfil + paso en que se quedó + chat reciente + lo que ya se
 *     intentó) para que Grok NO gaste tool-calls leyendo lo básico.
 *
 * NO llama a Grok por su cuenta: el cron hace el gate y decide a quién.
 * Requiere env XAI_API_KEY. Sin ella, sendInactivityEventToGrok() es no-op.
 */

import { getMessages } from './storage.js';
import { getMissingFields, FIELD_LABELS } from '../reengagement-queue.js';

const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_MODEL = 'grok-4.3';
const FLOWS_KEY = 'flows:v1';
const FOLLOWUP_LOG_KEY = (id) => `grok:followup:log:${id}`;
const FOLLOWUP_LOG_MAX = 8;           // cuántos seguimientos previos recordamos (y mandamos)
const RECENT_MESSAGES = 20;           // cuántos mensajes del chat pre-cargamos
const GROK_TIMEOUT_MS = 60000;        // tope por llamada (una corrida de cron no debe colgarse)

// Tools que Grok PUEDE usar en este evento. Acotado a lo necesario para dar seguimiento:
// leer (por si quiere confirmar algo), mandar WhatsApp, meter a un flow tipo lista,
// etiquetar y dejar recordatorio. NADA de borrar/editar vacantes, ads, proyectos, etc.
export const FOLLOWUP_ALLOWED_TOOLS = [
    'ver_perfil_candidato',
    'leer_chat',
    'enviar_mensaje',
    'enviar_banco_respuesta',
    'listar_flujos',
    'correr_flujo_candidato',
    'etiquetar',
    'crear_recordatorio'
];

// System prompt FIJO (no interpolar nada aquí dentro — debe ser idéntico en cada llamada
// para que xAI lo sirva de caché). Todo lo variable va en el mensaje "user".
export const FOLLOWUP_SYSTEM_PROMPT = [
    'Eres el cerebro de seguimiento de Brenda, la reclutadora por WhatsApp de Candidatic.',
    'Te llega un evento cuando un candidato con registro INCOMPLETO lleva ~1 hora sin responder.',
    'Tu trabajo: analizar en qué paso de la captura se quedó y decidir, con criterio, qué conviene hacer AHORA.',
    '',
    'Puedes decidir una de estas acciones (o ninguna):',
    '1. Mandarle un WhatsApp corto, cálido y específico para destrabar justo el dato que falta (usa enviar_mensaje; a 1h sigue dentro de la ventana de 24h, el texto libre funciona).',
    '2. Meterlo a un flujo tipo lista relevante (usa correr_flujo_candidato con un flujoId del catálogo que te paso).',
    '3. Ponerle una etiqueta útil para el equipo (usa etiquetar).',
    '4. NO hacer nada: si un humano ya tomó el chat (botActivo=false), si ya le insististe lo suficiente, o si no aporta volver a escribir.',
    '',
    'Reglas:',
    '- Mira "seguimientosPrevios": NO repitas el mismo mensaje ni el mismo ángulo; da un seguimiento que avance, no que moleste.',
    '- Sé breve y humano, en el tono de Brenda (cercano, con algún emoji, sin sonar a robot ni a venta agresiva).',
    '- No inventes datos del candidato ni vacantes; usa solo lo que tienes o lo que obtengas con las tools.',
    '- Si decides no actuar, está bien: es preferible al spam.',
    '',
    'Al final SIEMPRE responde UNA sola línea empezando con "RESUMEN:" describiendo qué hiciste y por qué (ej. "RESUMEN: mandé WhatsApp pidiendo su colonia, se atoró en paso 2"). Esa línea se guarda como bitácora.'
].join('\n');

/** Catálogo compacto de flujos tipo-lista activos (los que correr_flujo_candidato puede correr). */
async function getListFlowCatalog(redis) {
    try {
        const raw = await redis.get(FLOWS_KEY);
        const flows = raw ? JSON.parse(raw) : [];
        return (Array.isArray(flows) ? flows : [])
            .filter(f => f?.active && Array.isArray(f.nodes) && f.nodes.some(n => n?.type === 'inicio_lista'))
            .map(f => ({ id: f.id, nombre: f.name || 'Flujo sin nombre' }));
    } catch {
        return [];
    }
}

/** Duración humana desde un timestamp (ej. "1h 7m"). */
function sinceHuman(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h >= 24) { const d = Math.floor(h / 24); return `${d}d ${h % 24}h`; }
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

/** Lee la bitácora de seguimientos previos que Grok ya le dio a este candidato. */
export async function getFollowupLog(redis, candidateId) {
    try {
        const raw = await redis.lrange(FOLLOWUP_LOG_KEY(candidateId), 0, FOLLOWUP_LOG_MAX - 1);
        return (raw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    } catch {
        return [];
    }
}

/** Guarda una entrada en la bitácora (capada). Fire-and-forget seguro. */
export async function recordFollowup(redis, candidateId, entry) {
    try {
        const key = FOLLOWUP_LOG_KEY(candidateId);
        await redis.lpush(key, JSON.stringify({ cuando: new Date().toISOString(), ...entry }));
        await redis.ltrim(key, 0, FOLLOWUP_LOG_MAX - 1);
    } catch { /* no crítico */ }
}

/**
 * Arma el payload compacto del evento. Pre-carga todo lo que Grok necesita para decidir
 * sin tool-calls: perfil, en qué paso se quedó, inactividad, lo ya intentado, chat y flows.
 */
export async function buildInactivityPayload({ candidate, redis }) {
    const c = candidate;
    const lastUserMs = c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;
    const missing = getMissingFields(c).map(f => FIELD_LABELS[f] || f);

    const [log, flujos, mensajes] = await Promise.all([
        getFollowupLog(redis, c.id),
        getListFlowCatalog(redis),
        getMessages(c.id, RECENT_MESSAGES).catch(() => [])
    ]);

    return {
        evento: 'candidato_inactivo_1h',
        candidato: {
            id: c.id,
            nombre: c.nombreReal || c.nombre || null,
            nombreWhatsApp: c.nombre || null,
            telefono: c.whatsapp || null,
            edad: c.edad || null,
            municipio: c.municipio || null,
            colonia: c.colonia || null,
            escolaridad: c.escolaridad || null,
            categoria: c.categoria || null,
            experiencia: c.experiencia || null,
            vacanteActual: c.vacanteActual || null,
            etiquetas: Array.isArray(c.tags) ? c.tags : [],
            registrado: c.createdAt || null
        },
        // En qué paso de la extracción se quedó (lo clave para decidir)
        registro: {
            perfilCompleto: c.paso2Estado === 'completo',
            paso2Estado: c.paso2Estado || null,
            camposFaltantes: missing
        },
        inactividad: {
            ultimoMensajeCandidato: c.lastUserMessageAt || null,
            llevaSinResponder: sinceHuman(Date.now() - lastUserMs),
            botActivo: c.blocked !== true
        },
        // Lo que Grok YA intentó antes (para que dé seguimiento, no repita)
        seguimientosPrevios: log.map(e => ({ cuando: e.cuando, queHizo: e.resumen || e.queHizo || null })),
        // Catálogo de flows tipo lista que puede correr con correr_flujo_candidato
        flujosDisponibles: flujos,
        // Chat reciente (viejo→nuevo)
        chatReciente: (mensajes || []).map(m => ({
            de: m.from === 'me' ? 'reclutador' : (m.from === 'bot' ? 'brenda' : 'candidato'),
            texto: m.content || '',
            fecha: m.timestamp || m.fecha || null
        }))
    };
}

/** Extrae el texto final de la respuesta de /v1/responses de forma tolerante. */
function extractOutputText(data) {
    if (!data) return '';
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    const out = Array.isArray(data.output) ? data.output : [];
    const parts = [];
    for (const item of out) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
            // Cubre tanto {type:'output_text', text} como {text} sueltos.
            for (const ct of item.content) {
                if (typeof ct?.text === 'string') parts.push(ct.text);
            }
        }
    }
    return parts.join('\n').trim();
}

/**
 * Llama a Grok con el evento y el MCP de Candidatic adjunto. Grok decide y actúa vía MCP.
 * Devuelve { ok, resumen, usage, raw } o { ok:false, error }.
 *
 * @param {object}  args
 * @param {object}  args.payload   — de buildInactivityPayload()
 * @param {string}  args.candidateId
 * @param {string}  args.mcpUrl    — URL pública del MCP (xAI debe poder alcanzarla)
 * @param {string}  args.mcpToken  — Bearer del MCP (mcp:token)
 * @param {string}  [args.model]   — default grok-4.3
 */
export async function sendInactivityEventToGrok({ payload, candidateId, mcpUrl, mcpToken, model }) {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: 'XAI_API_KEY no configurada' };
    if (!mcpUrl || !mcpToken) return { ok: false, error: 'Falta mcpUrl o mcpToken' };

    const body = {
        model: model || DEFAULT_MODEL,
        input: [
            { role: 'system', content: FOLLOWUP_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(payload) }
        ],
        tools: [{
            type: 'mcp',
            server_url: mcpUrl,
            server_label: 'candidatic',
            authorization: mcpToken,
            allowed_tools: FOLLOWUP_ALLOWED_TOOLS
        }],
        // Parámetros recomendados por la doc de xAI; cap de salida para acotar gasto.
        temperature: 0.7,
        top_p: 0.95,
        max_output_tokens: 2000
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROK_TIMEOUT_MS);
    try {
        const resp = await fetch(XAI_RESPONSES_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                // Maximiza el prompt caching: misma conversación (candidato) → mismo prefijo.
                'x-grok-conv-id': `followup:${candidateId}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) {
            return { ok: false, error: data?.error?.message || data?.error || `HTTP ${resp.status}` };
        }
        const text = extractOutputText(data);
        const m = text.match(/RESUMEN:\s*(.+)$/im);
        return {
            ok: true,
            resumen: (m ? m[1] : text).trim().slice(0, 300) || 'Grok procesó el evento (sin resumen).',
            usage: data?.usage || null,
            raw: data
        };
    } catch (e) {
        return { ok: false, error: e.name === 'AbortError' ? `timeout ${GROK_TIMEOUT_MS}ms` : e.message };
    } finally {
        clearTimeout(timer);
    }
}
