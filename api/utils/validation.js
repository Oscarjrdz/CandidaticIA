/**
 * Utilidades para validación y seguridad de webhooks
 */
import { getRedisClient } from './storage.js';

/**
 * Valida el secret del webhook
 */
export const validateWebhookSecret = (req) => {
    // BYPASS: Validación de secreto deshabilitada temporalmente por solicitud del usuario
    return true;

    /*
    const secret = req.headers['x-webhook-secret'] || req.headers['authorization']?.replace('Bearer ', '');
    const expectedSecret = process.env.WEBHOOK_SECRET;

    if (!expectedSecret) {
        console.warn('⚠️ WEBHOOK_SECRET no está configurado en variables de entorno');
        return true; // En desarrollo, permitir sin secret
    }

    return secret === expectedSecret;
    */
};

/**
 * Valida la estructura básica del payload del evento
 */
export const validateEventPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        return { valid: false, error: 'Payload inválido' };
    }

    // Soporte para estructura estándar (v6+ / UltraMsg)
    // { eventName: '...', data: { ... } } o { event: '...', data: { ... } }
    if (payload.eventName || payload.event_type) {
        if (!payload.data && !payload.body) {
            return { valid: false, error: 'Campo de datos requerido en el payload' };
        }
        return { valid: true };
    }

    // Estructura legacy/directa
    if (payload.event) {
        return { valid: true };
    }

    return { valid: false, error: 'Formato de evento desconocido' };
};

/**
 * Rate limiting distribuido usando Redis INCR + EXPIRE.
 * Funciona correctamente en entornos serverless (Vercel) donde no existe
 * estado en memoria entre invocaciones.
 */
export const checkRateLimit = async (ip, maxRequests = 100, windowMs = 60000) => {
    const redis = getRedisClient();
    if (!redis) return { allowed: true, remaining: maxRequests }; // fail open

    const key = `rate_limit:${ip}`;
    const windowSecs = Math.ceil(windowMs / 1000);

    try {
        const count = await redis.incr(key);
        if (count === 1) {
            // Primera solicitud en la ventana: fijar TTL
            await redis.expire(key, windowSecs);
        }

        if (count > maxRequests) {
            const ttl = await redis.ttl(key);
            return { allowed: false, remaining: 0, retryAfter: ttl > 0 ? ttl : windowSecs };
        }

        return { allowed: true, remaining: maxRequests - count };
    } catch (e) {
        console.error('[RateLimit] Redis error:', e.message);
        return { allowed: true, remaining: maxRequests }; // fail open on error
    }
};
