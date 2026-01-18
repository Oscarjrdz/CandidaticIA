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
                const { saveCandidate, saveMessage, setLastActiveUser } = await import('./utils/storage.js');

                const candidateData = {
                    whatsapp: from,
                    nombre: name,
                    foto: data.profilePicUrl || null,
                    ultimoMensaje: timestamp,
                    ultimoPayload: payload
                };

                const savedCandidate = await saveCandidate(candidateData);
                console.log('👤 Candidato guardado/actualizado:', candidateData.nombre);

                // Actualizar último usuario activo (para fallback de outgoing)
                if (setLastActiveUser) {
                    await setLastActiveUser(from);
                }

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

            let recipientNumber = data.to || data.remoteJid || (data.key && data.key.remoteJid);

            const { saveMessage, getCandidateIdByPhone, getCandidateById, getLastActiveUser, updateCandidate } = await import('./utils/storage.js');

            // INTENTO 2 (Seguro): Verificar si 'data.from' es en realidad el usuario
            // En algunos adapters, 'from' en outgoing indica la "conversación" (el usuario), no el sender (bot).
            if (!recipientNumber && data.from) {
                const potentialCandidateId = await getCandidateIdByPhone(data.from.replace('@s.whatsapp.net', ''));
                if (potentialCandidateId) {
                    recipientNumber = data.from;
                    console.log('✅ "from" coincide con un candidato. Usándolo como destinatario.');
                }
            }

            // Fallback (Inseguro): Si no hay 'to' ni 'from' válido, usar el último usuario activo
            if (!recipientNumber && getLastActiveUser) {
                recipientNumber = await getLastActiveUser();
                if (recipientNumber) {
                    console.log('⚠️ Usando Fallback LastActiveUser (Riesgo de concurrencia):', recipientNumber);
                }
            }

            // Si no hay recipient explícito, ¿quizás 'from' es el usuario en algunas versiones? No, 'from' es el bot.

            const content = data.answer || data.body || (data.message && data.message.content) || 'Mensaje enviado';

            if (recipientNumber) {
                // Limpiar número (quitar @s.whatsapp.net si viene)
                const cleanNumber = recipientNumber.replace('@s.whatsapp.net', '');

                const candidateId = await getCandidateIdByPhone(cleanNumber);

                if (candidateId) {
                    const candidate = await getCandidateById(candidateId);
                    const candidateName = candidate ? candidate.nombre : 'Desconocido';

                    // DEDUPLICACIÓN: Verificar si ya existe un mensaje reciente idéntico enviado por "me" (api/chat)
                    // Esto evita duplicados cuando enviamos mensajes manuales desde el dashboard
                    const { getMessages } = await import('./utils/storage.js');
                    const recentMessages = await getMessages(candidateId, 5); // Últimos 5 mensajes

                    const isDuplicate = recentMessages.some(msg => {
                        const timeDiff = new Date(timestamp).getTime() - new Date(msg.timestamp).getTime();
                        // Coincide contenido Y fue enviado por 'me' Y ocurrió hace menos de 10 segundos
                        return msg.content === content &&
                            msg.from === 'me' &&
                            Math.abs(timeDiff) < 20000; // 20 segundos de ventana
                    });

                    if (isDuplicate) {
                        console.log('♻️ Mensaje duplicado detectado (ya guardado manualmente), saltando webhook save.');
                    } else {
                        await saveMessage(candidateId, {
                            from: 'bot',
                            content: content,
                            type: 'text',
                            timestamp: timestamp
                        });
                        console.log(`💾 Mensaje de AUTOPILOTO guardado para ${candidateName}`);

                        // ✅ NUEVO: Actualizar ultimoMensaje del candidato
                        const updateData = {
                            ultimoMensaje: timestamp
                        };

                        // 🕵️‍♂️ DETECCIÓN DE NOMBRE REAL
                        // Patrón flexible: "tu nombre es : [Nombre]" o "tu nombre es: [Nombre]"
                        const nameRegex = /tu nombre es\s*[:]?\s*([^.!?\n]+)/i;
                        const nameMatch = content.match(nameRegex);

                        if (nameMatch && nameMatch[1]) {
                            const capturedName = nameMatch[1].trim().replace(/[*_]/g, '');
                            console.log(`🎯 NOMBRE REAL DETECTADO: "${capturedName}" para ${cleanNumber}`);
                            updateData.nombreReal = capturedName;
                        }

                        // 📅 DETECCIÓN DE FECHA DE NACIMIENTO
                        const dobRegex = /(?:tu|la) fecha de nacimiento es\s*[:]?\s*([^.!?\n]+)/i;
                        const dobMatch = content.match(dobRegex);

                        if (dobMatch && dobMatch[1]) {
                            const capturedDob = dobMatch[1].trim().replace(/[*_]/g, '');
                            console.log(`🎂 FECHA DE NACIMIENTO DETECTADA: "${capturedDob}" para ${cleanNumber}`);
                            updateData.fechaNacimiento = capturedDob;
                        }

                        // 🏙️ DETECCIÓN DE MUNICIPIO
                        // Patrón flexible: "tu vives en : [Municipio]" o simplemente "vives en [Municipio]"
                        // Eliminamos dependencia estricta de "tu/usted" para ser más robustos
                        const cityRegex = /(?:vives?|resides?)\s+en\s*[:]?\s*([^.!?\n]+)/i;
                        const cityMatch = content.match(cityRegex);

                        // Fallback: "tu municipio es [Municipio]"
                        const cityRegex2 = /municipio\s+es\s*[:]?\s*([^.!?\n]+)/i;
                        const cityMatch2 = content.match(cityRegex2);

                        if (cityMatch && cityMatch[1]) {
                            const capturedCity = cityMatch[1].trim().replace(/[*_]/g, '');
                            console.log(`🏙️ MUNICIPIO DETECTADO (vives en): "${capturedCity}" para ${cleanNumber}`);
                            updateData.municipio = capturedCity;
                        } else if (cityMatch2 && cityMatch2[1]) {
                            const capturedCity = cityMatch2[1].trim().replace(/[*_]/g, '');
                            console.log(`🏙️ MUNICIPIO DETECTADO (municipio es): "${capturedCity}" para ${cleanNumber}`);
                            updateData.municipio = capturedCity;
                        }

                        await updateCandidate(candidateId, updateData);
                        console.log(`🕐 ultimoMensaje actualizado para ${candidateName}: ${timestamp}`);
                    }
                }
            } else {
                console.warn('⚠️ message.outgoing recibido sin campo "to" ni "remoteJid". No se puede asignar al historial.', data);
            }
            break;

        default:
            console.log('📋 Evento desconocido:', eventType);
    }
}
