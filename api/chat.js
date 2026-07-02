import { getMessages, getRecentMessages, saveMessage, getCandidateById, updateCandidate, updateMessageStatus, getRedisClient, validateAdminSession, getUsers, getRoles, isProfileComplete } from './utils/storage.js';
import { substituteVariables } from './utils/shortcuts.js';
import axios from 'axios';
import { sendUltraMsgMessage, getUltraMsgConfig, buildMetaTemplateComponents } from './whatsapp/utils.js';
import { estimateJsonBytes, recordUsageMetric } from './utils/usage-metrics.js';

// Candidatic legacy URLs removed as per UltraMsg migration.

const UNTAGGED_TAG_FILTER = '__candidatic_untagged__';

const normalizeTagName = (value = '') => String(value).trim().toLowerCase();

const candidateTagNames = (candidate = {}) => (
    Array.isArray(candidate.tags)
        ? candidate.tags
            .map(tag => typeof tag === 'string' ? tag : tag?.name)
            .map(normalizeTagName)
            .filter(Boolean)
        : []
);

const isCandidateUnread = (candidate = {}) => {
    const userTime = candidate.lastUserMessageAt ? new Date(candidate.lastUserMessageAt).getTime() : 0;
    if (!userTime) return false;
    const humanTime = candidate.lastHumanMessageAt ? new Date(candidate.lastHumanMessageAt).getTime() : 0;
    return userTime > humanTime;
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Validar sesión admin
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    try {
        // GET - Obtener historial
        if (req.method === 'GET') {
            const { candidateId } = req.query;
            if (!candidateId) {
                return res.status(400).json({ error: 'Falta candidateId' });
            }

            let messages = await getMessages(candidateId);

            // Aplicar estado 'read' persistido — cuando el candidato leyó nuestros mensajes,
            // el webhook guarda candidate:lastRead:{id}. Al recargar mensajes lo aplicamos
            // para que las palomitas azules sobrevivan cambios de sección.
            const redis = getRedisClient();
            if (redis) {
                const lastReadTs = await redis.get(`candidate:lastRead:${candidateId}`);
                if (lastReadTs) {
                    const lastRead = parseInt(lastReadTs);
                    messages = messages.map(m => {
                        if ((m.from === 'me' || m.from === 'bot') &&
                            (m.status === 'sent' || m.status === 'delivered') &&
                            new Date(m.timestamp || m.fecha || 0).getTime() <= lastRead) {
                            return { ...m, status: 'read' };
                        }
                        return m;
                    });
                }
            }

            // If no messages exist but candidate is flagged as unread, auto-clear silently
            if (messages.length === 0) {
                const candidate = await getCandidateById(candidateId);
                if (candidate?.lastUserMessageAt) {
                    const ut = new Date(candidate.lastUserMessageAt).getTime();
                    const ht = candidate.lastHumanMessageAt ? new Date(candidate.lastHumanMessageAt).getTime() : 0;
                    if (ut > ht) {
                        updateCandidate(candidateId, { lastHumanMessageAt: candidate.lastUserMessageAt }).catch(() => {});
                    }
                }
            }

            const payload = { success: true, messages };
            recordUsageMetric(getRedisClient(), '/api/chat', {
                messageReads: messages.length,
                responseBytes: estimateJsonBytes(payload),
                estimatedRedisBytes: estimateJsonBytes(messages)
            }).catch(() => {});
            return res.status(200).json(payload);
        }

        // PUT - Lock/Unlock chat (anti-duplication)
        if (req.method === 'PUT') {
            const { action, candidateId, userName, messageId, tagName, tagScope = 'tag', profileScope = 'all' } = req.body;
            const redis = getRedisClient();
            if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

            if (action === 'mark_read_by_tag') {
                const scope = tagScope === 'all'
                    ? 'all'
                    : (tagName === UNTAGGED_TAG_FILTER || tagScope === 'untagged' ? 'untagged' : 'tag');
                const normalizedTag = normalizeTagName(tagName);
                if (scope === 'tag' && !normalizedTag) {
                    return res.status(400).json({ error: 'Falta tagName' });
                }

                const normalizedProfileScope = ['complete', 'incomplete'].includes(profileScope) ? profileScope : 'all';

                const [users, roles, unreadIds, customFieldsRaw] = await Promise.all([
                    getUsers().catch(() => []),
                    getRoles().catch(() => []),
                    redis.smembers('candidates:unread'),
                    redis.get('custom_fields').catch(() => null)
                ]);
                const customFields = customFieldsRaw ? JSON.parse(customFieldsRaw) : [];
                const user = users.find(u => u.id === userId || u.whatsapp === userId);
                const role = roles.find(r => r.name === user?.role);
                const rolePermissions = role?.permissions || {};
                const allowedWa = Array.isArray(user?.allowed_wa_numbers) ? user.allowed_wa_numbers : [];
                const allowedLabels = Array.isArray(user?.allowed_labels)
                    ? user.allowed_labels.map(normalizeTagName).filter(Boolean)
                    : [];
                const allowedLabelSet = new Set(allowedLabels);
                const allowedCrm = Array.isArray(user?.allowed_crm_projects) ? user.allowed_crm_projects : [];
                const hasLabelRestriction = allowedLabelSet.size > 0;
                const hasCrmRestriction = allowedCrm.length > 0;
                const hasRBACRestriction = user?.role !== 'SuperAdmin' && user?.role !== 'Admin' && (hasLabelRestriction || hasCrmRestriction);
                const canSeeIncomplete = user?.role === 'SuperAdmin' || !rolePermissions || Object.keys(rolePermissions).length === 0 || rolePermissions.view_incomplete_candidates === true;

                const matchedIds = [];
                let scannedUnreadCandidates = 0;
                let estimatedScanBytes = 0;
                const CHUNK = 200;
                for (let i = 0; i < unreadIds.length; i += CHUNK) {
                    const ids = unreadIds.slice(i, i + CHUNK);
                    const pipe = redis.pipeline();
                    ids.forEach(id => pipe.get(`candidate:${id}`));
                    const rows = await pipe.exec();
                    scannedUnreadCandidates += ids.length;

                    for (let idx = 0; idx < rows.length; idx++) {
                        const [err, raw] = rows[idx];
                        if (err || !raw) continue;
                        estimatedScanBytes += raw.length;
                        let candidate;
                        try { candidate = JSON.parse(raw); } catch { continue; }
                        if (!candidate?.id || !isCandidateUnread(candidate)) continue;

                        if (user?.role !== 'SuperAdmin' && user?.role !== 'Admin' && allowedWa.length > 0) {
                            if (!candidate.incomingPhoneNumberId || !allowedWa.includes(candidate.incomingPhoneNumberId)) continue;
                        }

                        const complete = candidate.statusAudit === 'complete' || isProfileComplete(candidate, customFields);
                        if (!canSeeIncomplete && !complete) continue;
                        if (normalizedProfileScope === 'complete' && !complete) continue;
                        if (normalizedProfileScope === 'incomplete' && complete) continue;

                        const tags = candidateTagNames(candidate);
                        if (hasRBACRestriction) {
                            const inAllowedCrm = hasCrmRestriction && candidate.manualProjectId && allowedCrm.includes(candidate.manualProjectId);
                            const inAllowedLabel = hasLabelRestriction && tags.some(tag => allowedLabelSet.has(tag));
                            if (!inAllowedCrm && !inAllowedLabel) continue;
                        }

                        const matchesScope =
                            scope === 'all' ||
                            (scope === 'untagged' && tags.length === 0) ||
                            (scope === 'tag' && tags.includes(normalizedTag));

                        if (matchesScope) matchedIds.push(candidate.id);
                    }
                }

                const nowStr = new Date().toISOString();
                const updates = {
                    unreadMsgCount: 0,
                    lastBotMessageAt: nowStr,
                    ultimoMensajeBot: nowStr,
                    lastHumanMessageAt: nowStr
                };
                for (let i = 0; i < matchedIds.length; i += 20) {
                    const ids = matchedIds.slice(i, i + 20);
                    await Promise.all(ids.map(id => updateCandidate(id, updates).catch(() => null)));
                }
                await redis.incr('stats:unread:version').catch(() => {});

                const payload = {
                    success: true,
                    marked: matchedIds.length,
                    candidateIds: matchedIds,
                    scope,
                    profileScope: normalizedProfileScope,
                    tagName: scope === 'tag' ? tagName : null
                };
                recordUsageMetric(redis, '/api/chat/mark-read-by-tag', {
                    candidateReads: scannedUnreadCandidates,
                    redisWrites: matchedIds.length,
                    estimatedRedisBytes: estimatedScanBytes,
                    responseBytes: estimateJsonBytes(payload)
                }).catch(() => {});

                return res.status(200).json(payload);
            }

            if (!candidateId) return res.status(400).json({ error: 'Falta candidateId' });

            const lockKey = `chat_lock:${candidateId}`;
            const locksIndexKey = 'chat_locks:active';
            const publishLock = (payload) => {
                redis.publish('channel:sse:updates', JSON.stringify({
                    type: 'chat:lock',
                    candidateId,
                    ...payload,
                })).catch(() => {});
            };

            const sendReadReceiptToWhatsApp = async (explicitMessageId = null) => {
                const { markMessageAsRead } = await import('./whatsapp/utils.js');
                const candidate = await getCandidateById(candidateId).catch(() => null);
                const rawPhoneId = candidate?.incomingPhoneNumberId || '';
                const phoneNumberId = /^\d{10,}$/.test(String(rawPhoneId)) ? rawPhoneId : null;

                if (explicitMessageId) {
                    await markMessageAsRead(explicitMessageId, phoneNumberId);
                    return { marked: explicitMessageId, messageReads: 0 };
                }

                const messages = await getRecentMessages(candidateId, 20);
                recordUsageMetric(redis, '/api/chat', {
                    messageReads: messages.length,
                    estimatedRedisBytes: estimateJsonBytes(messages)
                }).catch(() => {});
                const latestIncoming = [...messages].reverse().find(m => m.from !== 'bot' && m.from !== 'me');
                const msgId = latestIncoming?.id || latestIncoming?.ultraMsgId || null;
                if (!msgId) return { marked: null, messageReads: messages.length };
                await markMessageAsRead(msgId, phoneNumberId);
                return { marked: msgId, messageReads: messages.length };
            };

            if (action === 'lock') {
                // Set lock with 60s TTL (heartbeat renews it)
                const now = Date.now();
                const lock = {
                    user: userName || 'Reclutador',
                    userId,
                    lockedAt: new Date(now).toISOString(),
                    refreshedAt: new Date(now).toISOString(),
                    expiresAt: now + 60000
                };
                const pipe = redis.pipeline();
                pipe.set(lockKey, JSON.stringify(lock), 'EX', 60);
                pipe.zadd(locksIndexKey, lock.expiresAt, candidateId);
                pipe.expire(locksIndexKey, 120);
                await pipe.exec();
                publishLock({ action: 'lock', lock });
                return res.status(200).json({ success: true, locked: true });
            }

            if (action === 'unlock') {
                const pipe = redis.pipeline();
                pipe.del(lockKey);
                pipe.zrem(locksIndexKey, candidateId);
                await pipe.exec();
                publishLock({ action: 'unlock' });
                return res.status(200).json({ success: true, locked: false });
            }

            if (action === 'heartbeat') {
                // Renew TTL
                const rawLock = await redis.get(lockKey);
                if (rawLock) {
                    let lock;
                    try {
                        lock = JSON.parse(rawLock);
                    } catch {
                        lock = { user: rawLock };
                    }
                    const now = Date.now();
                    lock = {
                        ...lock,
                        userId: lock.userId || userId,
                        refreshedAt: new Date(now).toISOString(),
                        expiresAt: now + 60000
                    };
                    const pipe = redis.pipeline();
                    pipe.set(lockKey, JSON.stringify(lock), 'EX', 60);
                    pipe.zadd(locksIndexKey, lock.expiresAt, candidateId);
                    pipe.expire(locksIndexKey, 120);
                    await pipe.exec();
                    publishLock({ action: 'lock', lock });
                }
                return res.status(200).json({ success: true });
            }

            if (action === 'presence') {
                // We'll use this now to emit SSE typing status internally for recruiters
                if (req.body.status === 'composing') {
                    import('./utils/sse-notify.js').then(({ notifyCandidateUpdate }) => {
                        notifyCandidateUpdate(candidateId, { recruiterTyping: userName || 'Alguien' }).catch(() => {});
                    }).catch(()=> { });
                }
                return res.status(200).json({ success: true });
            }

            if (action === 'mark_read') {
                // Just clear the counter (blue ticks), but DO NOT update botTime so Rule 2 persists
                try {
                    await updateCandidate(candidateId, { unreadMsgCount: 0 });
                } catch (e) {}

                // Send blue ticks to WhatsApp
                const receipt = await sendReadReceiptToWhatsApp(messageId || null);
                return res.status(200).json({ success: true, marked: receipt.marked });
            }

            if (action === 'send_read_receipt') {
                // ONLY send blue ticks to WhatsApp, do NOT touch the database
                const receipt = await sendReadReceiptToWhatsApp(messageId || null);
                return res.status(200).json({ success: true, marked: receipt.marked });
            }

            if (action === 'mark_handled') {
                // EXPLICIT BUTTON: Clear counter AND update botTime to bypass "last to speak" rule
                const nowStr = new Date().toISOString();
                try {
                    await updateCandidate(candidateId, { 
                        unreadMsgCount: 0,
                        lastBotMessageAt: nowStr,
                        ultimoMensajeBot: nowStr,
                        lastHumanMessageAt: nowStr
                    });
                } catch (e) {}
                return res.status(200).json({ success: true, marked: 'handled' });
            }

            if (action === 'mark_unread') {
                try {
                    await updateCandidate(candidateId, {
                        lastHumanMessageAt: null
                    });
                } catch (e) {}
                return res.status(200).json({ success: true, marked: 'unread' });
            }

            return res.status(400).json({ error: 'Invalid action' });
        }

        if (req.method === 'POST') {
            const { candidateId, message, type = 'text', mediaUrl, base64Data, replyToId, extraParams: incomingExtraParams = {}, senderId, senderName } = req.body;

            const typeHasOwnPayload = ['template', 'location', 'contacts', 'interactive'].includes(type);
            if (!candidateId || (!message && !mediaUrl && !typeHasOwnPayload)) {
                return res.status(400).json({ error: 'Faltan datos requeridos' });
            }

            const candidate = await getCandidateById(candidateId);
            if (!candidate) return res.status(404).json({ error: 'Candidato no encontrado' });

            const primerNombre = (candidate.nombreReal?.trim() || '').split(' ')[0];
            const finalMessage = message
                ? substituteVariables(message, candidate)
                    .replace(/\{\{nombre\}\}/gi, primerNombre)
                    .replace(/[^\S\n]{2,}/g, ' ')
                    .trim()
                : '';

            const ultraConfig = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);

            if (!ultraConfig) return res.status(400).json({ error: 'Faltan credenciales' });

            if (type === 'reaction') {
                if (!replyToId) return res.status(400).json({ error: 'Falta ID del mensaje a reaccionar' });
                const { sendUltraMsgReaction } = await import('./whatsapp/utils.js');
                
                // Fire off the API
                const sendResult = await sendUltraMsgReaction(ultraConfig.instanceId, ultraConfig.token, replyToId, message, candidate.whatsapp);
                
                if (sendResult) {
                     const { updateMessageReaction } = await import('./utils/storage.js');
                     await updateMessageReaction(candidateId, replyToId, message);
                     
                     // Force stat update for SSE
                     const redisClient = getRedisClient();
                     if (redisClient) await redisClient.del('stats:bot:last_calc');
                     
                     return res.status(200).json({ success: true, reaction: message, id: replyToId });
                }
                return res.status(500).json({ error: 'Error sending reaction' });
            }

            const timestamp = new Date().toISOString();
            const msgId = req.body.tempId || `msg_${Date.now()}`;

            let contentToSave = finalMessage;
            if (type === 'template' && req.body.templateData) {
                const tData = req.body.templateData;
                let realText = '';
                if (tData.components) {
                    const bodyComp = tData.components.find(c => (c.type || '').toUpperCase() === 'BODY');
                    if (bodyComp && bodyComp.text) {
                        const _nr = candidate.nombreReal?.trim().split(/\s+/).slice(0, 2).join(' ');
                        realText = bodyComp.text.replace(/\{\{\d+\}\}/g, _nr || candidate.nombre || 'Candidato');
                    }
                }
                const displayName = tData.name.replace(/_/g, ' ');
                contentToSave = `⚡ Plantilla oficial: *${displayName}*\n\n${realText}`.trim();
            } else if (type === 'interactive') {
                const intType = incomingExtraParams.interactiveType || 'button';
                if (intType === 'button' && incomingExtraParams.buttons) {
                    contentToSave = `${finalMessage}\n\n[Botones: ${incomingExtraParams.buttons.join(' | ')}]`;
                } else if (intType === 'list' && incomingExtraParams.listItems) {
                    contentToSave = `${finalMessage}\n\n[Lista: ${incomingExtraParams.listItems.map(i => i.title).join(', ')}]`;
                } else if (intType === 'product') {
                    contentToSave = `[Producto del Catálogo: ${incomingExtraParams.productSku}]`;
                }
            } else if (type === 'contacts') {
                contentToSave = `[Tarjeta de Contacto: ${incomingExtraParams.contactName || 'N/A'}]`;
            } else if (type === 'location') {
                contentToSave = `[Ubicación: ${incomingExtraParams.name || 'Mapa'}]`;
            }

            // 1. Transactional Save
            const msgToSave = {
                id: msgId,
                from: 'me',
                content: contentToSave,
                type: type,
                mediaUrl: mediaUrl,
                status: 'queued',
                timestamp: timestamp
            };

            if (replyToId) {
                msgToSave.contextInfo = {
                    quotedMessage: {
                        stanzaId: replyToId,
                        participant: candidate.whatsapp, // Simplification
                        conversation: ''
                    }
                };
            }

            await saveMessage(candidateId, msgToSave);

            // 2. Send message via Meta Cloud API
            try {
                // Templates always go via Meta Cloud API (even for gateway candidates)

                let sendResult;
                const cleanTo = candidate.whatsapp.replace(/\D/g, '');
                const extraParams = { ...incomingExtraParams };
                if (replyToId) extraParams.referenceId = replyToId;

                if (type === 'template') {
                    const tData = req.body.templateData;
                    const _nr = candidate.nombreReal?.trim().split(/\s+/).slice(0, 2).join(' ');
                    const candidateNameFallback = _nr || candidate.nombre || 'Candidato';
                    extraParams.templateName = tData.name;
                    extraParams.languageCode = tData.language || 'es_MX';
                    
                    // Construcción dinámica de componentes (DRY helper)
                    const componentsToSend = buildMetaTemplateComponents(
                        tData.components,
                        candidateNameFallback,
                        { mediaUrl: req.body.mediaUrl }
                    );

                    if (componentsToSend.length > 0) {
                        extraParams.components = componentsToSend;
                    }
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, contentToSave, 'template', extraParams);
                } else if (type === 'text') {
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, finalMessage, 'chat', extraParams);
                } else if (type === 'interactive' || type === 'contacts' || type === 'location') {
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, finalMessage, type, extraParams);
                } else {
                    // ═══ MEDIA (image/document/video/audio) ═══
                    // If the mediaUrl is an internal Redis URL, upload to Meta first for reliability
                    let deliveryContent = mediaUrl;
                    const isInternalMedia = mediaUrl && mediaUrl.startsWith('/api/image') && mediaUrl.includes('id=');
                    const makeAbsoluteUrl = (relUrl, mediaId, fileType) => {
                        const protocol = req.headers['x-forwarded-proto'] || 'https';
                        const host = req.headers.host || 'candidatic.com';
                        if (mediaId) {
                            const extMap = { image: '.jpg', video: '.mp4', audio: '.mp3', document: '.pdf' };
                            return `${protocol}://${host}/api/media/${mediaId}${extMap[fileType] || ''}`;
                        }
                        return `${protocol}://${host}${relUrl}`;
                    };

                    if (isInternalMedia) {
                        try {
                            const urlObj = new URL(mediaUrl, 'https://candidatic.com');
                            const redisMediaId = urlObj.searchParams.get('id');
                            
                            if (redisMediaId) {
                                const redis = getRedisClient();
                                const metaRaw = await redis.get(`meta:image:${redisMediaId}`);
                                const meta = metaRaw ? JSON.parse(metaRaw) : {};
                                const filename = meta.filename || (type === 'document' ? 'documento.pdf' : 'imagen.jpg');

                                // Strategy 1: Use pre-cached Meta media_id (from upload step — most reliable)
                                if (meta.metaMediaId) {
                                    extraParams.mediaId = meta.metaMediaId;
                                    extraParams.filename = filename;
                                    deliveryContent = '';
                                    console.log(`✅ [Media] Using pre-cached Meta media_id=${meta.metaMediaId}`);
                                } else {
                                    // Strategy 2: Re-upload base64 from Redis to Meta
                                    const base64Str = await redis.get(`image:${redisMediaId}`);
                                    if (base64Str) {
                                        const buffer = Buffer.from(base64Str, 'base64');
                                        const mimeType = meta.mime || (type === 'document' ? 'application/pdf' : 'image/jpeg');

                                        console.log(`📤 [Media] Re-uploading ${filename} (${mimeType}, ${Math.round(buffer.length/1024)}KB) to Meta...`);
                                        const { uploadMediaToMeta } = await import('./whatsapp/utils.js');
                                        const uploadResult = await uploadMediaToMeta(buffer, mimeType, filename);

                                        if (uploadResult?.mediaId) {
                                            extraParams.mediaId = uploadResult.mediaId;
                                            extraParams.filename = filename;
                                            deliveryContent = '';
                                            console.log(`✅ [Media] Re-uploaded to Meta → media_id=${uploadResult.mediaId}`);
                                            // Cache for next time
                                            meta.metaMediaId = uploadResult.mediaId;
                                            redis.set(`meta:image:${redisMediaId}`, JSON.stringify(meta)).catch(() => {});
                                        } else {
                                            console.log(`⚠️ [Media] Meta upload returned no ID, falling back to URL`);
                                            deliveryContent = makeAbsoluteUrl(mediaUrl, redisMediaId, type);
                                        }
                                    } else {
                                        console.log(`⚠️ [Media] No base64 data in Redis for ${redisMediaId}, falling back to URL`);
                                        deliveryContent = makeAbsoluteUrl(mediaUrl, redisMediaId, type);
                                    }
                                }
                            } else {
                                deliveryContent = makeAbsoluteUrl(mediaUrl, null, type);
                            }
                        } catch (uploadErr) {
                            console.error('⚠️ Meta media upload failed, falling back to URL:', uploadErr.message);
                            deliveryContent = makeAbsoluteUrl(mediaUrl, null, type);
                        }
                    } else if (mediaUrl && mediaUrl.startsWith('/')) {
                        deliveryContent = makeAbsoluteUrl(mediaUrl, null, type);
                    }

                    extraParams.caption = finalMessage;
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, deliveryContent, type, extraParams);
                }

                if (sendResult) {
                    if (sendResult.success) {
                        // PERSIST TO REDIS
                        await updateCandidate(candidateId, {
                            ultimoMensajeBot: timestamp,
                            lastBotMessageAt: timestamp,
                            lastHumanMessageAt: timestamp,
                            unreadMsgCount: 0
                        });

                        // ── Recruiter activity stats ──────────────────────────
                        if (senderId) {
                            const today = new Date().toISOString().split('T')[0];
                            const ttl = 86400 * 30;
                            const lastUserMsg = candidate.lastUserMessageAt
                                ? new Date(candidate.lastUserMessageAt).getTime() : 0;
                            const inWindow = lastUserMsg > 0 && (Date.now() - lastUserMsg) < 86400000;
                            const redis2 = getRedisClient();
                            if (redis2) {
                                const p = redis2.pipeline();
                                if (senderName) p.set(`recruiter:meta:${senderId}`, JSON.stringify({ userName: senderName }), 'EX', ttl);
                                p.sadd(`recruiter:ids:${today}`, senderId);
                                p.expire(`recruiter:ids:${today}`, ttl);
                                p.incr(`recruiter:msgs:${senderId}:${today}`);
                                p.expire(`recruiter:msgs:${senderId}:${today}`, ttl);
                                p.sadd(`recruiter:chats:${senderId}:${today}`, candidateId);
                                p.expire(`recruiter:chats:${senderId}:${today}`, ttl);
                                const windowKey = inWindow ? `recruiter:win24:${senderId}:${today}` : `recruiter:out24:${senderId}:${today}`;
                                p.sadd(windowKey, candidateId);
                                p.expire(windowKey, ttl);
                                p.exec().catch(() => {});
                            }
                        }

                        // Update the message in the Redis list
                        const remoteId = sendResult.messageId || sendResult.data?.messages?.[0]?.id || sendResult.data?.id || sendResult.data?.messageId;
                        const updatedData = {
                            status: 'sent',
                            ultraMsgId: remoteId
                        };
                        await updateMessageStatus(candidateId, msgToSave.id, 'sent', updatedData);

                        msgToSave.status = 'sent';
                        msgToSave.ultraMsgId = remoteId;
                    } else {
                        // Preserve the full Meta error for UI display
                        const metaErrorCode = sendResult.data?.error?.code || '';
                        const metaErrorMsg = sendResult.error || JSON.stringify(sendResult.data?.error || sendResult.data || 'Unknown');
                        const err = new Error(metaErrorMsg);
                        err.metaCode = metaErrorCode;
                        throw err;
                    }
                }
            } catch (sendErr) {
                console.error('❌ Error sending via Meta:', sendErr.message);
                const errorPayload = { error: sendErr.message };
                if (sendErr.metaCode) errorPayload.metaCode = sendErr.metaCode;
                await updateMessageStatus(candidateId, msgToSave.id, 'failed', errorPayload);
                msgToSave.status = 'failed';
                msgToSave.error = sendErr.message;
                if (sendErr.metaCode) msgToSave.metaCode = sendErr.metaCode;
            }

            // Update candidate last activity timestamps globally
            await updateCandidate(candidateId, {
                ultimoMensaje: timestamp
            });
            
            // Force instant SSE stat recalculation so unread badge drops in realtime
            const redisClient = getRedisClient();
            if (redisClient) {
                await redisClient.del('stats:bot:last_calc');
            }

            return res.status(200).json({ success: true, message: msgToSave });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error('Chat API Error:', error.message, error.stack);
        return res.status(500).json({ error: 'Error interno', details: error.message });
    }
}
