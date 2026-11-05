/**
 * grok-internal-chat.js — Despierta a Grok (xAI) cuando un reclutador le manda un
 * MENSAJE DIRECTO en el CHAT INTERNO del dashboard (el chat entre reclutadores, NO
 * WhatsApp con candidatos).
 *
 * Flujo:
 *   reclutador DM → api/internal-chat.js (POST, to: 'grok-ai')
 *     → wakeGrokFromInternalDM()  [fire-and-forget con runInBackground]
 *       → sendInternalEventToGrok()  [llamada a xAI /v1/responses con el MCP pegado]
 *         → Grok lee contexto con `leer_chat_interno` (si lo necesita) y responde
 *            con `enviar_chat_interno` (él decide: privado a quien le escribió, o a TODOS).
 *
 * Igual que grok-event.js, el diseño está enfocado en AHORRO DE TOKENS:
 *   - Grok SOLO despierta cuando le escriben directo (si nadie le escribe, cero tokens).
 *   - System prompt FIJO + header x-grok-conv-id por reclutador → prompt caching de xAI.
 *   - allowed_tools acotado (no las ~58 del MCP) → menos manifiesto por llamada.
 *   - Payload MÍNIMO (solo quién escribió + el texto). El chat NO se manda completo:
 *     Grok lo consulta bajo demanda con `leer_chat_interno`.
 *   - max_output_tokens bajo.
 *
 * Requiere env XAI_API_KEY + el MCP encendido (mcp:enabled + mcp:token). Sin eso, es no-op.
 */

import { runInBackground } from './background.js';

const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_MODEL = 'grok-4.3';
const GROK_TIMEOUT_MS = 60000;
const SETTINGS_KEY = 'grok:interno:settings';
const WAKE_LOCK_PREFIX = 'grok:interno:lock:'; // debounce por reclutador (colapsa ráfagas)

// Identidad de Grok dentro del chat interno (debe coincidir con el frontend InternalChat.jsx).
export const GROK_INTERNAL_ID = 'grok-ai';
export const GROK_INTERNAL_NAME = 'Grok';

// Defaults editables en Redis `grok:interno:settings`. A diferencia del cron de inactividad,
// este SÍ viene prendido por default: es una acción a petición EXPLÍCITA del reclutador.
export const INTERNAL_DEFAULTS = {
    enabled: true,
    model: DEFAULT_MODEL,
    maxOutputTokens: 1500,
    debounceSeconds: 3    // dos mensajes del mismo reclutador en <3s → un solo despertar
};

// Tools que Grok PUEDE usar al responder en el chat interno. Acotado a lo útil:
// las 2 del chat interno + consultas de solo-lectura para contestar dudas del equipo.
// Editable vía grok:interno:settings.allowedTools.
export const INTERNAL_ALLOWED_TOOLS = [
    'leer_chat_interno',
    'enviar_chat_interno',
    'buscar_candidato',
    'ver_perfil_candidato',
    'leer_chat',
    'estadisticas_base'
];

// System prompt FIJO (no interpolar nada aquí dentro → xAI lo sirve de caché en cada llamada).
export const INTERNAL_SYSTEM_PROMPT = [
    'Eres Grok, el asistente de IA del EQUIPO de reclutadores de Candidatic. Participas en su',
    'CHAT INTERNO: el chat privado ENTRE reclutadores dentro del dashboard. NO es WhatsApp con',
    'candidatos — aquí hablas con el equipo, no con la gente que busca empleo.',
    '',
    'Un reclutador te acaba de escribir un mensaje directo. Ayúdale: responde dudas, consulta',
    'datos del dashboard cuando haga falta y avisa al equipo si algo le sirve a todos.',
    '',
    'CÓMO RESPONDES (importante):',
    '- El chat interno NO muestra tu texto solo. Para que ALGUIEN lea tu respuesta DEBES llamar a',
    '  la tool `enviar_chat_interno`. Si no la llamas, nadie ve nada.',
    '- TÚ decides el destinatario: `para` con el id del reclutador = respuesta PRIVADA solo a quien',
    '  te escribió; `para:"all"` = BROADCAST a todo el equipo. Usa "all" solo cuando de verdad le',
    '  sirve a todos (un aviso, un dato general); si es algo de esa persona, respóndele en privado.',
    '- Si necesitas contexto de la conversación, léelo con `leer_chat_interno` (no te lo paso',
    '  completo, para ahorrar tokens).',
    '- Para preguntas sobre candidatos o la base, usa las tools de consulta (buscar_candidato,',
    '  ver_perfil_candidato, estadisticas_base).',
    '',
    'Sé breve, claro y en español, tono cercano de compañero de equipo. No inventes datos: si no',
    'sabes, dilo o búscalo con una tool. Responde SIEMPRE con al menos una llamada a',
    'enviar_chat_interno.'
].join('\n');

// Bitácora de diagnóstico en Redis (como mcp:log / webhooks:log). Permite ver por qué
// Grok no contestó sin tener acceso a los logs de Vercel. Capada a 30, TTL 1 día.
async function logInterno(redis, entry) {
    try {
        await redis.pipeline()
            .lpush('grok:interno:log', JSON.stringify({ t: new Date().toISOString(), ...entry }))
            .ltrim('grok:interno:log', 0, 29)
            .expire('grok:interno:log', 86400)
            .exec();
    } catch { /* el log nunca rompe nada */ }
}

/** Arma el payload compacto del evento (solo lo mínimo; el resto Grok lo consulta con tools). */
export function buildInternalPayload({ fromId, fromName, text }) {
    return {
        evento: 'dm_chat_interno',
        de: { id: fromId, nombre: fromName || 'Reclutador' },
        mensaje: text,
        fecha: new Date().toISOString(),
        comoResponder: `Llama a enviar_chat_interno: para:"${fromId}" = privado a esta persona, para:"all" = todo el equipo.`
    };
}

/** Extrae el texto final de /v1/responses de forma tolerante (igual que grok-event.js). */
function extractOutputText(data) {
    if (!data) return '';
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    const out = Array.isArray(data.output) ? data.output : [];
    const parts = [];
    for (const item of out) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
            for (const ct of item.content) {
                if (typeof ct?.text === 'string') parts.push(ct.text);
            }
        }
    }
    return parts.join('\n').trim();
}

/**
 * Llama a Grok con el DM interno y el MCP de Candidatic adjunto. Grok responde vía MCP
 * (enviar_chat_interno). Devuelve { ok, resumen, usage } o { ok:false, error }.
 */
export async function sendInternalEventToGrok({ payload, fromId, mcpUrl, mcpToken, model, maxOutputTokens, allowedTools }) {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: 'XAI_API_KEY no configurada' };
    if (!mcpUrl || !mcpToken) return { ok: false, error: 'Falta mcpUrl o mcpToken' };

    const body = {
        model: model || DEFAULT_MODEL,
        input: [
            { role: 'system', content: INTERNAL_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(payload) }
        ],
        tools: [{
            type: 'mcp',
            server_url: mcpUrl,
            server_label: 'candidatic',
            authorization: mcpToken,
            allowed_tools: Array.isArray(allowedTools) && allowedTools.length ? allowedTools : INTERNAL_ALLOWED_TOOLS
        }],
        temperature: 0.7,
        top_p: 0.95,
        max_output_tokens: maxOutputTokens || INTERNAL_DEFAULTS.maxOutputTokens
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROK_TIMEOUT_MS);
    try {
        const resp = await fetch(XAI_RESPONSES_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                // Mismo reclutador → mismo prefijo de conversación → prompt caching de xAI.
                'x-grok-conv-id': `interno:${fromId}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) {
            return { ok: false, error: data?.error?.message || data?.error || `HTTP ${resp.status}` };
        }
        return { ok: true, resumen: extractOutputText(data).slice(0, 300), usage: data?.usage || null };
    } catch (e) {
        return { ok: false, error: e.name === 'AbortError' ? `timeout ${GROK_TIMEOUT_MS}ms` : e.message };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Punto de entrada desde api/internal-chat.js. Hace TODO el gating barato (cero tokens si no
 * procede) y, si procede, despierta a Grok EN SEGUNDO PLANO (no bloquea la respuesta HTTP al
 * reclutador, pero sobrevive al congelamiento serverless vía runInBackground/waitUntil).
 *
 * Nunca lanza: cualquier fallo se traga (el DM ya se guardó; que Grok no conteste no debe
 * romper el chat interno).
 */
export function wakeGrokFromInternalDM({ req, redis, fromId, fromName, text }) {
    runInBackground((async () => {
        try {
            if (!redis || !fromId || !text?.trim()) return;
            if (fromId === GROK_INTERNAL_ID) return; // nunca despertar a Grok por su propio mensaje

            // Settings + gates (todo barato, antes de gastar un token).
            let settings = {};
            try { const raw = await redis.get(SETTINGS_KEY); settings = raw ? JSON.parse(raw) : {}; } catch { /* usa defaults */ }
            const cfg = { ...INTERNAL_DEFAULTS, ...settings };
            if (cfg.enabled === false) { await logInterno(redis, { fromId, skip: 'disabled' }); return; }
            if (!process.env.XAI_API_KEY) { await logInterno(redis, { fromId, skip: 'no_xai_key' }); return; }

            const [mcpToken, mcpEnabledRaw] = await Promise.all([redis.get('mcp:token'), redis.get('mcp:enabled')]);
            const mcpEnabled = mcpEnabledRaw === '1' || mcpEnabledRaw === 'true';
            if (!mcpToken || !mcpEnabled) { await logInterno(redis, { fromId, skip: 'mcp_off' }); return; }

            // Debounce: colapsa ráfagas del mismo reclutador en un solo despertar.
            const lockKey = `${WAKE_LOCK_PREFIX}${fromId}`;
            const got = await redis.set(lockKey, '1', 'EX', Math.max(1, cfg.debounceSeconds), 'NX');
            if (got !== 'OK') { await logInterno(redis, { fromId, skip: 'debounced' }); return; }

            await logInterno(redis, { fromId, paso: 'llamando_xai', model: cfg.model });

            // "Grok está escribiendo…" — puro SSE, cero tokens. Que la espera se sienta viva.
            const publishTyping = (typing) => redis.publish('channel:sse:updates', JSON.stringify({
                type: 'internal:typing', from: GROK_INTERNAL_ID, fromName: GROK_INTERNAL_NAME, to: fromId, typing
            })).catch(() => {});
            publishTyping(true);

            const mcpUrl = process.env.MCP_PUBLIC_URL || `https://${req?.headers?.host}/api/mcp`;
            const payload = buildInternalPayload({ fromId, fromName, text });
            let result;
            try {
                result = await sendInternalEventToGrok({
                    payload, fromId, mcpUrl, mcpToken,
                    model: cfg.model,
                    maxOutputTokens: cfg.maxOutputTokens,
                    allowedTools: Array.isArray(cfg.allowedTools) ? cfg.allowedTools : INTERNAL_ALLOWED_TOOLS
                });
            } finally {
                publishTyping(false); // la respuesta ya se envió (o falló): apaga el typing pase lo que pase
            }

            if (!result.ok) {
                console.error(`[GROK-INTERNO] ❌ ${fromId}: ${result.error}`);
                await logInterno(redis, { fromId, ok: false, error: result.error });
            } else {
                const u = result.usage;
                const toks = u ? ` [in:${u.input_tokens ?? u.prompt_tokens ?? '?'} out:${u.output_tokens ?? u.completion_tokens ?? '?'}]` : '';
                console.log(`[GROK-INTERNO] ✅ ${fromId}: ${result.resumen || '(respondió vía MCP)'}${toks}`);
                await logInterno(redis, { fromId, ok: true, resumen: result.resumen || null, usage: u || null });
            }
        } catch (e) {
            console.error('[GROK-INTERNO] excepción:', e?.message);
            await logInterno(redis, { fromId, ok: false, error: `excepción: ${e?.message}` }).catch(() => {});
        }
    })());
}
