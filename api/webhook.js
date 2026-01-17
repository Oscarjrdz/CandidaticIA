/**
 * Endpoint principal para recibir webhooks de BuilderBot
 * POST /api/webhook
 */

import { validateWebhookSecret, validateEventPayload, checkRateLimit } from './utils/validation.js';
import { saveEvent } from './utils/storage.js';

export default async function handler(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Solo aceptar POST
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Método no permitido',
            message: 'Solo se aceptan peticiones POST'
        });
    }

    try {
        // 1. Rate limiting
        const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
        const rateLimit = checkRateLimit(ip);

        if (!rateLimit.allowed) {
            return res.status(429).json({
                error: 'Demasiadas peticiones',
                retryAfter: rateLimit.retryAfter
            });
        }

        // 2. Validar secret (seguridad básica)
        if (!validateWebhookSecret(req)) {
            console.warn('🔒 Intento de acceso no autorizado desde:', ip);
            return res.status(401).json({
                error: 'No autorizado',
                message: 'Secret de webhook inválido'
            });
        }

        // 3. Validar payload
        const payload = req.body;
        const validation = validateEventPayload(payload);

        if (!validation.valid) {
            return res.status(400).json({
                error: 'Payload inválido',
                message: validation.error
            });
        }

        // 4. Guardar evento
        const savedEvent = await saveEvent(payload);

        // 5. Log para debugging
        console.log('✅ Webhook recibido:', {
            event: payload.event,
            botId: payload.botId,
            timestamp: payload.timestamp || payload.ts,
            id: savedEvent.id
        });

        // 6. Aquí puedes agregar lógica personalizada según el tipo de evento
        await processEvent(payload);

        // 7. Responder a BuilderBot
        return res.status(200).json({
            success: true,
            message: 'Evento recibido correctamente',
            eventId: savedEvent.id,
            receivedAt: savedEvent.receivedAt
        });

    } catch (error) {
        console.error('❌ Error procesando webhook:', error);

        return res.status(500).json({
            error: 'Error interno del servidor',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando webhook'
        });
    }
}

/**
 * Procesa eventos según su tipo
 */
async function processEvent(payload) {
    const eventType = payload.event;

    switch (eventType) {
        case 'status.ready':
            console.log('🟢 Bot está listo:', payload.botId);
            // Aquí puedes enviar notificación, actualizar DB, etc.
            break;

        case 'status.require_action':
            console.log('🟡 Bot requiere acción (QR):', payload.botId);
            // Notificar al usuario que debe escanear QR
            break;

        case 'status.disconnect':
            console.log('🔴 Bot desconectado:', payload.botId);
            // Alertar sobre desconexión
            break;

        case 'message.incoming':
            console.log('📨 Mensaje recibido de:', payload.from);
            // Procesar mensaje entrante
            break;

        case 'message.outgoing':
            console.log('📤 Mensaje enviado a:', payload.to);
            // Registrar mensaje enviado
            break;

        case 'message.calling':
            console.log('📞 Llamada recibida de:', payload.from);
            // Manejar llamada
            break;

        default:
            console.log('📋 Evento desconocido:', eventType);
    }
}
