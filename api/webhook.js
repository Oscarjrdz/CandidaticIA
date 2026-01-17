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
        console.log('📥 INCOMING WEBHOOK REQUEST:', {
            method: req.method,
            headers: req.headers,
            body: req.body
        });

        // 1. Rate limiting
        const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
        const rateLimit = checkRateLimit(ip);

        if (!rateLimit.allowed) {
            console.warn('⚠️ Rate limit exceeded for IP:', ip);
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

        // 3. Validar payload (Relaxed for debugging)
        const payload = req.body || {};
        const validation = validateEventPayload(payload);

        if (!validation.valid) {
            console.warn('⚠️ Payload inválido pero procesando igual para debug:', validation.error, payload);
            // return res.status(400).json({ error: 'Payload inválido', message: validation.error });
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
/**
 * Procesa eventos según su tipo
 */
async function processEvent(payload) {
    // Normalizar datos entre diferentes formatos de payload
    const eventType = payload.eventName || payload.event;

    // Extraer datos relevantes (soporte híbrido)
    const data = payload.data || payload;
    const from = data.from;
    const name = data.name || data.pushName || 'Sin nombre';
    const body = data.body || (data.message && data.message.content) || '';

    // Timestamp: BuilderBot v6 usa messageTimestamp (Unix timestamp)
    let timestamp = new Date().toISOString();
    if (data.messageTimestamp) {
        // Convertir Unix timestamp (segundos) a milisegundos si es necesario
        const ts = typeof data.messageTimestamp === 'string' ? parseInt(data.messageTimestamp) : data.messageTimestamp;
        timestamp = new Date(ts > 1000000000000 ? ts : ts * 1000).toISOString();
    } else if (payload.timestamp || payload.ts) {
        timestamp = payload.timestamp || payload.ts;
    }

    console.log(`🔄 Procesando evento: ${eventType}`, { from, name, timestamp });

    switch (eventType) {
        case 'status.ready':
            console.log('🟢 Bot está listo:', payload.botId || data.botId);
            break;

        case 'status.require_action':
            console.log('🟡 Bot requiere acción (QR):', payload.botId);
            break;

        case 'status.disconnect':
            console.log('🔴 Bot desconectado:', payload.botId);
            break;

        case 'message.incoming':
            console.log('📨 Mensaje recibido de:', from);

            // Guardar candidato automáticamente
            if (from) {
                const { saveCandidate, saveMessage } = await import('./utils/storage.js');

                const candidateData = {
                    whatsapp: from,
                    nombre: name,
                    foto: data.profilePicUrl || null,
                    ultimoMensaje: timestamp,
                    ultimoPayload: payload
                };

                const savedCandidate = await saveCandidate(candidateData);
                console.log('👤 Candidato guardado/actualizado:', candidateData.nombre);

                // Guardar mensaje en historial
                if (savedCandidate && savedCandidate.id) {
                    await saveMessage(savedCandidate.id, {
                        from: 'candidate',
                        content: body,
                        type: 'text', // TODO: Detectar tipo real (image, voice, etc)
                        timestamp: timestamp
                    });
                    console.log('💾 Mensaje guardado en historial');
                }
            }
            break;

        case 'message.outgoing':
            // Docs: { eventName: "message.outgoing", data: { answer: "...", from: "...", ... } }
            // IMPORTANTE: Necesitamos saber a QUIÉN se le envió. 
            // Si 'data.to' no viene, es un problema para saber a qué chat asignarlo.
            // Algunos webhooks traen 'to', otros 'remoteJid', otros dependen de 'from'.
            // Vamos a loguear TODO para debuggear la primera vez.
            console.log('📤 OUTGOING DETECTADO:', JSON.stringify(data, null, 2));

            const recipientNumber = data.to || data.remoteJid || (data.key && data.key.remoteJid);
            // Si no hay recipient explícito, ¿quizás 'from' es el usuario en algunas versiones? No, 'from' es el bot.

            const content = data.answer || data.body || (data.message && data.message.content) || 'Mensaje enviado';

            if (recipientNumber) {
                // Limpiar número (quitar @s.whatsapp.net si viene)
                const cleanNumber = recipientNumber.replace('@s.whatsapp.net', '');

                const { saveMessage, getCandidateIdByPhone, getCandidateById } = await import('./utils/storage.js');

                const candidateId = await getCandidateIdByPhone(cleanNumber);

                if (candidateId) {
                    const candidate = await getCandidateById(candidateId);
                    const candidateName = candidate ? candidate.nombre : 'Desconocido';

                    await saveMessage(candidateId, {
                        from: 'bot',
                        content: content,
                        type: 'text',
                        timestamp: timestamp
                    });
                    console.log(`💾 Mensaje de AUTOPILOTO guardado para ${candidateName}`);
                }
            } else {
                console.warn('⚠️ message.outgoing recibido sin campo "to" ni "remoteJid". No se puede asignar al historial.', data);
            }
            break;

        default:
            console.log('📋 Evento desconocido:', eventType);
    }
}
