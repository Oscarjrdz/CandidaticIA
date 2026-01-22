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

        // 3. Validar payload
        const payload = req.body || {};
        const validation = validateEventPayload(payload);

        if (!validation.valid) {
            console.warn('⚠️ Payload inválido pero procesando igual para debug:', validation.error, payload);
        }

        // 4. Guardar evento (Wrapped in try/catch to prevent blocking critical flow)
        let savedEvent = { id: 'skipped', receivedAt: new Date().toISOString() };
        try {
            savedEvent = await saveEvent(payload);
        } catch (saveError) {
            console.error('⚠️ Save Event Failed (Continuing execution):', saveError.message);
        }

        // 5. Log básico
        console.log('✅ Webhook recibido:', {
            event: payload.event,
            botId: payload.botId,
            timestamp: savedEvent.receivedAt,
            id: savedEvent?.id
        });

        // 6. Procesar evento (Lógica principal)
        await processEvent(payload);

        // 7. Responder a BuilderBot
        return res.status(200).json({
            success: true,
            message: 'Evento recibido correctamente',
            eventId: savedEvent?.id
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
    // Normalizar datos entre diferentes formatos de payload
    const eventType = payload.eventName || payload.event;

    // Extraer datos relevantes (soporte híbrido)
    const data = payload.data || payload;

    // Normalize 'from' (remove suffixes like @s.whatsapp.net or @c.us if present, AND remove non-digits)
    const rawFrom = data.from || '';
    const from = rawFrom.replace(/@.+/, '').replace(/\D/g, ''); // Robust number cleaning
    const name = data.name || data.pushName || 'Sin nombre';
    const body = data.body || (data.message && data.message.content) || '';

    // Timestamp: BuilderBot v6 usa messageTimestamp (Unix timestamp)
    let timestamp = new Date().toISOString();
    if (data.messageTimestamp) {
        const ts = typeof data.messageTimestamp === 'string' ? parseInt(data.messageTimestamp) : data.messageTimestamp;
        timestamp = new Date(ts > 1000000000000 ? ts : ts * 1000).toISOString();
    } else if (payload.timestamp || payload.ts) {
        timestamp = payload.timestamp || payload.ts;
    }

    console.log(`🔄 Procesando evento: ${eventType}`, { from, name });

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

            // --- ADMIN COMMANDS (SIMON says...) ---
            const ADMIN_NUMBER = '5218116038195';

            // Allow strict 521, or 81... or just check endsWith to be safe.
            const isAdmin = (from === ADMIN_NUMBER) || (from === '8116038195') || (from.endsWith('8116038195'));

            if (isAdmin) {
                const match = body.match(/^simon\s*(\d+)/i);
                if (match) {
                    const targetPhoneInput = match[1].replace(/\D/g, ''); // Clean target too
                    console.log(`⚡️ COMANDO ADMIN DETECTADO: Activar ${targetPhoneInput}. Sender: ${from}`);

                    try {
                        const { getUsers, saveUser } = await import('./utils/storage.js');
                        const { sendMessage } = await import('./utils/messenger.js');

                        const users = await getUsers();
                        const userToActivate = users.find(u => u.whatsapp.endsWith(targetPhoneInput));

                        if (userToActivate) {
                            if (userToActivate.status !== 'Active') {
                                userToActivate.status = 'Active';
                                await saveUser(userToActivate);
                                // Notify Admin & User
                                await sendMessage(from, `✅ Usuario ${userToActivate.name} (${userToActivate.whatsapp}) ha sido ACTIVADO.`);
                                await sendMessage(userToActivate.whatsapp, `🎉 ¡Cuenta Activada!\nHola ${userToActivate.name}, tu acceso a Candidatic IA ha sido aprobado.\n\nYa puedes iniciar sesión con tu WhatsApp.`);
                            } else {
                                await sendMessage(from, `⚠️ El usuario ${userToActivate.name} ya estaba activo.`);
                            }
                        } else {
                            await sendMessage(from, `❌ No encontré ningún usuario pendiente con terminación ${targetPhoneInput}.`);
                        }
                    } catch (err) {
                        console.error('Error executing admin command:', err);
                    }
                    // CRITICAL: Stop processing here so we don't save the "simon" command as candidate history.
                    return;
                }
            }

            // Guardar candidato automáticamente
            if (from) {
                const { saveCandidate, saveMessage, setLastActiveUser, updateCandidate, getCandidateIdByPhone } = await import('./utils/storage.js');

                // 1. Check if candidate exists (Update vs Create)
                const existingId = await getCandidateIdByPhone(from);

                const candidateData = {
                    whatsapp: from,
                    nombre: name,
                    foto: data.profilePicUrl || null,
                    primerContacto: new Date().toISOString(),
                    ultimoPayload: payload
                };

                // If exists, force ID to merge/update
                let savedCandidate;
                if (existingId) {
                    console.log(`🔄 Actualizando candidato existente: ${name} (${existingId})`);
                    // Use update to MERGE data, not overwrite
                    savedCandidate = await updateCandidate(existingId, candidateData);
                } else {
                    console.log(`🆕 Creando candidato NUEVO: ${name}`);
                    savedCandidate = await saveCandidate(candidateData);
                }

                if (setLastActiveUser) {
                    await setLastActiveUser(from);
                }

                if (savedCandidate && savedCandidate.id) {
                    await saveMessage(savedCandidate.id, {
                        from: 'candidate',
                        content: body,
                        type: 'text',
                        timestamp: timestamp
                    });

                    await updateCandidate(savedCandidate.id, {
                        lastUserMessageAt: timestamp,
                        ultimoMensaje: timestamp
                    });
                    console.log('💾 Mensaje guardado en historial y timestamps actualizados');
                }
            }
            break;

        case 'message.outgoing':
            // Docs: { eventName: "message.outgoing", data: { answer: "...", from: "...", ... } }

            let recipientNumber = data.to || data.remoteJid || (data.key && data.key.remoteJid);
            const content = data.answer || data.body || (data.message && data.message.content) || 'Mensaje enviado';

            // --- FILTER: AUTH & SYSTEM MESSAGES (Ghost Mode) ---
            // Don't save PINs, Login notifications, or Admin alerts to candidate history
            const AUTH_PATTERNS = [
                /Tu PIN de acceso/i,
                /SOLICITUD DE NUEVA CUENTA/i,
                /tu cuenta está pendiente de aprobación/i,
                /tu acceso a Candidatic IA ha sido aprobado/i,
                /ha sido ACTIVADO/i,
                /Test Message/i
            ];

            if (AUTH_PATTERNS.some(regex => regex.test(content))) {
                console.log('🚫 Skipping History Save for AUTH/SYSTEM message');
                break; // Exit switch, do not save
            }

            const { saveMessage, getCandidateIdByPhone, getCandidateById, getLastActiveUser, updateCandidate, getMessages } = await import('./utils/storage.js');

            // INTENTO 2 (Seguro): Verificar si 'data.from' es en realidad el usuario
            if (!recipientNumber && data.from) {
                const potentialCandidateId = await getCandidateIdByPhone(data.from.replace('@s.whatsapp.net', ''));
                if (potentialCandidateId) {
                    recipientNumber = data.from;
                }
            }

            // Fallback (Inseguro): Si no hay 'to' ni 'from' válido, usar el último usuario activo
            if (!recipientNumber && getLastActiveUser) {
                recipientNumber = await getLastActiveUser();
            }

            if (recipientNumber) {
                // Limpiar número (quitar @s.whatsapp.net si viene)
                const cleanNumber = recipientNumber.replace('@s.whatsapp.net', '');

                const candidateId = await getCandidateIdByPhone(cleanNumber);

                if (candidateId) {
                    const candidate = await getCandidateById(candidateId);
                    const candidateName = candidate ? candidate.nombre : 'Desconocido';

                    // DEDUPLICACIÓN: Verificar si ya existe un mensaje reciente idéntico enviado por "me" (api/chat)
                    const recentMessages = await getMessages(candidateId, 5);

                    const isDuplicate = recentMessages.some(msg => {
                        const timeDiff = new Date(timestamp).getTime() - new Date(msg.timestamp).getTime();
                        return msg.content === content &&
                            msg.from === 'me' &&
                            Math.abs(timeDiff) < 20000;
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

                        const updateData = {
                            ultimoMensaje: timestamp,
                            lastBotMessageAt: timestamp,
                            ultimoMensajeBot: timestamp
                        };

                        // 🤖 DETECCIÓN DINÁMICA CON REGLAS DE AUTOMATIZACIÓN
                        try {
                            const { getRedisClient } = await import('./utils/storage.js');
                            const redis = getRedisClient();
                            const rulesJson = await redis.get('automation_rules');

                            if (rulesJson) {
                                const rules = JSON.parse(rulesJson);
                                rules.forEach(rule => {
                                    if (rule.enabled) {
                                        try {
                                            const regex = new RegExp(rule.pattern, 'i');
                                            const match = content.match(regex);
                                            if (match && match[1]) {
                                                const captured = match[1].trim().replace(/[*_]/g, '');
                                                updateData[rule.field] = captured;
                                            }
                                        } catch (error) {
                                            console.warn(`⚠️ Invalid regex in rule ${rule.id}:`, error.message);
                                        }
                                    }
                                });
                            } else {
                                applyLegacyRules(content, updateData, cleanNumber);
                            }
                        } catch (error) {
                            console.error('❌ Error loading automation rules:', error);
                            applyLegacyRules(content, updateData, cleanNumber);
                        }

                        await updateCandidate(candidateId, updateData);
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

/**
 * Legacy fallback: Apply hardcoded rules if Redis fails
 */
function applyLegacyRules(content, updateData, cleanNumber) {
    // Nombre
    const nameMatch = content.match(/tu nombre es\s*[:]?\s*([^.!?\n]+)/i);
    if (nameMatch?.[1]) {
        updateData.nombreReal = nameMatch[1].trim().replace(/[*_]/g, '');
    }

    // Fecha nacimiento
    const dobMatch = content.match(/(?:tu|la) fecha de nacimiento es\s*[:]?\s*([^.!?\n]+)/i);
    if (dobMatch?.[1]) {
        updateData.fechaNacimiento = dobMatch[1].trim().replace(/[*_]/g, '');
    }

    // Municipio
    const cityMatch = content.match(/(?:vives?|resides?)\s+en\s*[:]?\s*[:]?\s*([^.!?\n]+)/i);
    if (cityMatch?.[1]) {
        updateData.municipio = cityMatch[1].trim().replace(/[*_]/g, '');
    }

    // Categoría
    const jobMatch = content.match(/buscando\s+empleo\s+de\s*[:]?\s*([^.!?\n]+)/i);
    if (jobMatch?.[1]) {
        updateData.categoria = jobMatch[1].trim().replace(/[*_]/g, '');
    }

    // Empleo
    const employmentMatch = content.match(/entonces\s+(No|Sí)\s+Tienes\s+empleo/i);
    if (employmentMatch?.[1]) {
        updateData.tieneEmpleo = employmentMatch[1];
    }
}
