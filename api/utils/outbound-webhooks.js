// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOKS SALIENTES  —  Candidatic notifica eventos a una URL externa (ej. Grok)
// ═══════════════════════════════════════════════════════════════════════════
// Cada evento hace un POST JSON a la URL configurada, con la llave en el header
// `X-Candidatic-Key`. Qué eventos se envían es configurable desde el panel
// (Configuración → Webhooks salientes). Todo es FIRE-AND-FORGET: jamás bloquea ni
// rompe el camino caliente (webhook de entrada / extractor de Brenda).
//
//   Config:  Redis `webhooks:config` = { enabled, url, secret, events:{<tipo>:true} }
//   Log:     Redis `webhooks:log`    = últimas 50 entregas (status/errores)
// ═══════════════════════════════════════════════════════════════════════════

import { getRedisClient } from './storage.js';

const CONFIG_KEY = 'webhooks:config';
const LOG_KEY = 'webhooks:log';

// Catálogo de eventos que el panel puede activar. `activo:false` = aún no cableado
// en el código (se puede prender en el panel pero todavía no dispara); se deja listo
// para ir agregando más sin tocar la UI.
export const EVENT_TYPES = [
    { id: 'mensaje_entrante', label: 'Mensaje entrante del candidato', activo: true },
    { id: 'chat_nuevo', label: 'Chat/candidato nuevo', activo: true },
    { id: 'perfil_completo', label: 'Perfil completado', activo: true },
    { id: 'cita_agendada', label: 'Cita agendada', activo: false }
];

// Caché en memoria del config para no leer Redis en cada mensaje (camino caliente).
let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 10000; // 10s — un cambio en el panel se propaga en ≤10s por instancia

export function invalidateWebhookCache() { _cache = null; _cacheAt = 0; }

async function getConfig(redis) {
    const now = Date.now();
    if (_cache && (now - _cacheAt) < CACHE_MS) return _cache;
    const r = redis || getRedisClient();
    if (!r) return null;
    const raw = await r.get(CONFIG_KEY).catch(() => null);
    _cache = raw ? JSON.parse(raw) : { enabled: false, url: '', secret: '', events: {} };
    _cacheAt = now;
    return _cache;
}

function logWebhook(redis, entry) {
    try {
        const r = redis || getRedisClient();
        if (!r) return;
        r.pipeline()
            .lpush(LOG_KEY, JSON.stringify({ t: new Date().toISOString(), ...entry }))
            .ltrim(LOG_KEY, 0, 49)
            .expire(LOG_KEY, 86400)
            .exec()
            .catch(() => {});
    } catch { /* el log nunca rompe nada */ }
}

/**
 * Dispara un webhook saliente. FIRE-AND-FORGET: no se debe await-ear.
 * @param {object} redis  cliente Redis (o null → lo obtiene solo)
 * @param {string} eventType  uno de EVENT_TYPES
 * @param {object} opts  { candidate, texto, extra }
 */
export function dispatchWebhook(redis, eventType, { candidate = null, texto = null, extra = null } = {}) {
    (async () => {
        const cfg = await getConfig(redis);
        if (!cfg || !cfg.enabled || !cfg.url) return;
        if (!cfg.events || cfg.events[eventType] !== true) return;

        const c = candidate || {};
        const payload = {
            evento: eventType,
            candidateId: c.id || null,
            nombre: (c.nombreReal && String(c.nombreReal).trim()) || c.nombre || null,
            telefono: c.whatsapp || null,
            etiquetas: Array.isArray(c.tags) ? c.tags : [],
            perfilCompleto: c.paso2Estado === 'completo',
            texto: texto != null ? String(texto) : null,
            fecha: new Date().toISOString(),
            ...(extra && typeof extra === 'object' ? extra : {})
        };

        try {
            const resp = await fetch(cfg.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Candidatic-Key': cfg.secret || '' },
                body: JSON.stringify(payload)
            });
            logWebhook(redis, { evento: eventType, candidateId: payload.candidateId, status: resp.status, ok: resp.ok });
        } catch (e) {
            logWebhook(redis, { evento: eventType, candidateId: payload.candidateId, error: e.message });
        }
    })().catch(() => {});
}
