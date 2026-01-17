/**
 * Utilidades para validación y seguridad de webhooks
 */

/**
 * Valida el secret del webhook
 */
export const validateWebhookSecret = (req) => {
    // BYPASS: Validación de secreto deshabilitada temporalmente por solicitud del usuario
    console.log('⚠️ Validación de webhook secret está DESHABILITADA');
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
 * Valida la estructura básica del payload de BuilderBot
 */
/**
 * Valida la estructura básica del payload de BuilderBot
 */
export const validateEventPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        return { valid: false, error: 'Payload inválido' };
    }

    // Soporte para estructura estándar de BuilderBot (v6+)
    // { eventName: '...', data: { ... } }
    if (payload.eventName) {
        if (!payload.data) {
            return { valid: false, error: 'Campo "data" requerido para BuilderBot' };
        }
        return { valid: true };
    }

    // Estructura legacy/custom
    if (payload.event) {
        // Relax timestamp check for now as some versions might not send it at root
        return { valid: true };
    }

    return { valid: false, error: 'Formato desconocido (falta eventName o event)' };
};

/**
 * Rate limiting simple basado en IP
 * En producción, usar Vercel Edge Config o Redis
 */
const requestCounts = new Map();

export const checkRateLimit = (ip, maxRequests = 100, windowMs = 60000) => {
    const now = Date.now();
    const key = `${ip}`;

    if (!requestCounts.has(key)) {
        requestCounts.set(key, { count: 1, resetTime: now + windowMs });
        return { allowed: true, remaining: maxRequests - 1 };
    }

    const record = requestCounts.get(key);

    if (now > record.resetTime) {
        // Reset window
        requestCounts.set(key, { count: 1, resetTime: now + windowMs });
        return { allowed: true, remaining: maxRequests - 1 };
    }

    if (record.count >= maxRequests) {
        return {
            allowed: false,
            remaining: 0,
            retryAfter: Math.ceil((record.resetTime - now) / 1000)
        };
    }

    record.count++;
    return { allowed: true, remaining: maxRequests - record.count };
};

/**
 * Limpia registros antiguos de rate limiting
 */
export const cleanupRateLimitRecords = () => {
    const now = Date.now();
    for (const [key, record] of requestCounts.entries()) {
        if (now > record.resetTime) {
            requestCounts.delete(key);
        }
    }
};

// Limpiar cada 5 minutos
setInterval(cleanupRateLimitRecords, 5 * 60 * 1000);
