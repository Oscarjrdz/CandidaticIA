// /api/webhooks/config  —  Panel de Webhooks salientes (Configuración).
//
// GET  → { enabled, url, secret, events, eventTypes, recentLog }
// PUT  → { enabled?, url?, events? } para actualizar; { action:'rotate' } para
//        regenerar la llave. Invalida la caché del dispatcher.
//
// Auth: sesión de reclutador (validateAdminSession), igual que el resto del dashboard.

import { randomBytes } from 'crypto';
import { EVENT_TYPES, invalidateWebhookCache } from '../utils/outbound-webhooks.js';

const CONFIG_KEY = 'webhooks:config';
const LOG_KEY = 'webhooks:log';

function newSecret() {
    return `whk_${randomBytes(24).toString('hex')}`;
}

async function loadConfig(redis) {
    const raw = await redis.get(CONFIG_KEY).catch(() => null);
    const cfg = raw ? JSON.parse(raw) : { enabled: false, url: '', secret: '', events: {} };
    if (!cfg.secret) {
        cfg.secret = newSecret();
        await redis.set(CONFIG_KEY, JSON.stringify(cfg));
    }
    return cfg;
}

export default async function handler(req, res) {
    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');
        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });
        const redis = getRedisClient();
        if (!redis) return res.status(503).json({ error: 'Redis no disponible' });

        if (req.method === 'GET') {
            const cfg = await loadConfig(redis);
            const logRaw = await redis.lrange(LOG_KEY, 0, 24).catch(() => []);
            const recentLog = (logRaw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
            return res.status(200).json({
                success: true,
                enabled: !!cfg.enabled,
                url: cfg.url || '',
                secret: cfg.secret,
                events: cfg.events || {},
                eventTypes: EVENT_TYPES,
                recentLog
            });
        }

        if (req.method === 'PUT') {
            const cfg = await loadConfig(redis);
            const { enabled, url, events, action } = req.body || {};

            if (action === 'rotate') {
                cfg.secret = newSecret();
                await redis.set(CONFIG_KEY, JSON.stringify(cfg));
                invalidateWebhookCache();
                return res.status(200).json({ success: true, secret: cfg.secret });
            }

            if (typeof enabled === 'boolean') cfg.enabled = enabled;
            if (typeof url === 'string') cfg.url = url.trim();
            if (events && typeof events === 'object') {
                // Solo aceptamos las llaves conocidas (whitelist de EVENT_TYPES).
                const valid = {};
                for (const et of EVENT_TYPES) if (events[et.id] === true) valid[et.id] = true;
                cfg.events = valid;
            }
            await redis.set(CONFIG_KEY, JSON.stringify(cfg));
            invalidateWebhookCache();
            return res.status(200).json({ success: true, enabled: cfg.enabled, url: cfg.url, events: cfg.events });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
