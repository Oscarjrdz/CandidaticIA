import { getMessages, saveMessage, getCandidateById, updateCandidate, updateMessageStatus, getRedisClient } from './utils/storage.js';
import { substituteVariables } from './utils/shortcuts.js';
import axios from 'axios';
import { sendUltraMsgMessage, getUltraMsgConfig } from './whatsapp/utils.js';

// Candidatic legacy URLs removed as per UltraMsg migration.

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // GET - Obtener historial
        if (req.method === 'GET') {
            const { candidateId } = req.query;
            if (!candidateId) {
                return res.status(400).json({ error: 'Falta candidateId' });
            }

            const messages = await getMessages(candidateId);

            return res.status(200).json({ success: true, messages });
        }

        // PUT - Lock/Unlock chat (anti-duplication)
        if (req.method === 'PUT') {
            const { action, candidateId, userName } = req.body;
            if (!candidateId) return res.status(400).json({ error: 'Falta candidateId' });

            const redis = getRedisClient();
            if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

            const lockKey = `chat_lock:${candidateId}`;

            if (action === 'lock') {
                // Set lock with 60s TTL (heartbeat renews it)
                await redis.set(lockKey, JSON.stringify({
                    user: userName || 'Reclutador',
                    lockedAt: new Date().toISOString()
                }), 'EX', 60);
                return res.status(200).json({ success: true, locked: true });
            }

            if (action === 'unlock') {
                await redis.del(lockKey);
                return res.status(200).json({ success: true, locked: false });
            }

            if (action === 'heartbeat') {
                // Renew TTL
                const exists = await redis.exists(lockKey);
                if (exists) {
                    await redis.expire(lockKey, 60);
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
                const messages = await getMessages(candidateId);
                // Just clear the counter (blue ticks), but DO NOT update botTime so Rule 2 persists
                try {
                    await updateCandidate(candidateId, { unreadMsgCount: 0 });
                } catch (e) {}

                // Send blue ticks to WhatsApp
                const latestIncoming = [...messages].reverse().find(m => m.from !== 'bot' && m.from !== 'me');
                if (latestIncoming && (latestIncoming.id || latestIncoming.ultraMsgId)) {
                    const msgId = latestIncoming.id || latestIncoming.ultraMsgId;
                    import('./whatsapp/utils.js').then(async ({ markMessageAsRead }) => {
                        await markMessageAsRead(msgId);
                    }).catch(e => console.error("Error importing markMessageAsRead", e));
                    return res.status(200).json({ success: true, marked: msgId });
                }
                return res.status(200).json({ success: true, marked: null });
            }

            if (action === 'send_read_receipt') {
                const messages = await getMessages(candidateId);
                // ONLY send blue ticks to WhatsApp, do NOT touch the database
                const latestIncoming = [...messages].reverse().find(m => m.from !== 'bot' && m.from !== 'me');
                if (latestIncoming && (latestIncoming.id || latestIncoming.ultraMsgId)) {
                    const msgId = latestIncoming.id || latestIncoming.ultraMsgId;
                    import('./whatsapp/utils.js').then(async ({ markMessageAsRead }) => {
                        await markMessageAsRead(msgId);
                    }).catch(e => console.error("Error importing markMessageAsRead", e));
                    return res.status(200).json({ success: true, marked: msgId });
                }
                return res.status(200).json({ success: true, marked: null });
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
                // Set unreadMsgCount=1 and clear botTime so it triggers unread visual
                try {
                    await updateCandidate(candidateId, { 
                        unreadMsgCount: 1,
                        lastBotMessageAt: null,
                        ultimoMensajeBot: null
                    });
                } catch (e) {}
                return res.status(200).json({ success: true, marked: 'unread' });
            }

            return res.status(400).json({ error: 'Invalid action' });
        }

        if (req.method === 'POST') {
            const { candidateId, message, type = 'text', mediaUrl, base64Data, replyToId } = req.body;

            if (!candidateId || (!message && !mediaUrl && type !== 'template')) {
                return res.status(400).json({ error: 'Faltan datos requeridos' });
            }

            const candidate = await getCandidateById(candidateId);
            if (!candidate) return res.status(404).json({ error: 'Candidato no encontrado' });

            const finalMessage = message ? substituteVariables(message, candidate) : '';

            // ═══ META CLOUD API: Single number, no instance routing ═══
            const ultraConfig = await getUltraMsgConfig();

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
                        realText = bodyComp.text.replace(/\{\{\d+\}\}/g, candidate.nombreReal || candidate.nombre || 'Candidato');
                    }
                }
                const displayName = tData.name.replace(/_/g, ' ');
                contentToSave = `⚡ Plantilla oficial: *${displayName}*\n\n${realText}`.trim();
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

            // 2. Send message (auto-routing: Gateway vs Meta handled by sendUltraMsgMessage)
            try {
                // Templates always go via Meta Cloud API (even for gateway candidates)

                let sendResult;
                const cleanTo = candidate.whatsapp.replace(/\D/g, '');
                const extraParams = {};
                if (replyToId) extraParams.referenceId = replyToId;

                if (type === 'template') {
                    const tData = req.body.templateData;
                    const candidateNameFallback = String(candidate.nombreReal || candidate.nombre || 'Buen día').trim();
                    extraParams.templateName = tData.name;
                    extraParams.languageCode = tData.language || 'es_MX';
                    
                    // Construcción dinámica de componentes (soporta BODY, HEADER textual/media, BUTTONS)
                    const componentsToSend = [];
                    (tData.components || []).forEach(comp => {
                        const cType = (comp.type || '').toLowerCase();
                        
                        if (cType === 'body' || cType === 'header') {
                            if (cType === 'body' || (comp.format || '').toLowerCase() === 'text') {
                                const textInfo = comp.text || '';
                                const varMatches = textInfo.match(/\{\{\d+\}\}/g) || [];
                                let expectedCount = [...new Set(varMatches)].length;
                                
                                // Source of truth from Meta's parsed examples
                                if (cType === 'body' && comp.example?.body_text?.[0]) {
                                    expectedCount = comp.example.body_text[0].length;
                                } else if (cType === 'header' && comp.example?.header_text) {
                                    expectedCount = comp.example.header_text.length;
                                }

                                if (expectedCount > 0) {
                                    componentsToSend.push({
                                        type: cType,
                                        parameters: Array(expectedCount).fill(0).map(() => ({ type: "text", text: candidateNameFallback }))
                                    });
                                }
                            } else if (cType === 'header') {
                                const format = (comp.format || '').toLowerCase();
                                if (['image', 'video', 'document'].includes(format)) {
                                    const placeholders = {
                                        image: 'https://raw.githubusercontent.com/davidcelis/logo/master/logo.png',
                                        video: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
                                        document: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
                                    };
                                    const mUrl = req.body.mediaUrl || placeholders[format] || placeholders.image;
                                    componentsToSend.push({
                                        type: 'header',
                                        parameters: [ { type: format, [format]: { link: mUrl } } ]
                                    });
                                }
                            }
                        } else if (cType === 'buttons') {
                            (comp.buttons || []).forEach((btn, index) => {
                                if ((btn.type || '').toLowerCase() === 'url' && (btn.url || '').includes('{{')) {
                                    const varMatches = (btn.url || '').match(/\{\{\d+\}\}/g) || [];
                                    const uniqueVars = [...new Set(varMatches)];
                                    if (uniqueVars.length > 0) {
                                        componentsToSend.push({
                                            type: 'button',
                                            sub_type: 'url',
                                            index: String(index),
                                            parameters: uniqueVars.map(() => ({ type: "text", text: "info" }))
                                        });
                                    }
                                }
                            });
                        }
                    });

                    if (componentsToSend.length > 0) {
                        extraParams.components = componentsToSend;
                    }
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, contentToSave, 'template', extraParams);
                } else if (type === 'text') {
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, finalMessage, 'chat', extraParams);
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
                        throw new Error(`UltraMSG Error: ${sendResult.error || JSON.stringify(sendResult.data)}`);
                    }
                }
            } catch (sendErr) {
                console.error('❌ Error sending via UltraMsg:', sendErr.message);
                await updateMessageStatus(candidateId, msgToSave.id, 'failed', { error: sendErr.message });
                msgToSave.status = 'failed';
                msgToSave.error = sendErr.message;
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
        return res.status(500).json({ error: 'Error interno', details: error.message, stack: (error.stack || '').split('\n').slice(0, 5).join(' | ') });
    }
}
