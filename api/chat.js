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
                // Find the latest incoming message
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
            const msgId = `msg_${Date.now()}`;

            let contentToSave = finalMessage;
            if (type === 'template' && req.body.templateData) {
                contentToSave = `[Plantilla: ${req.body.templateData.name}] Hola ${candidate.nombreReal || candidate.nombre || 'Buen día'}...`;
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

            // 2. Send via UltraMsg
            try {
                let sendResult;
                let deliveryContent = base64Data || mediaUrl;

                // Convert relative /api/image?id=xxx to an absolute URL for GatewayWapp
                if (mediaUrl && !base64Data) {
                    const protocol = req.headers['x-forwarded-proto'] || 'https';
                    const host = req.headers.host || 'candidatic.com';

                    let absoluteUrl = mediaUrl;

                    // Handle /api/image?id=xxx format (our standard storage format)
                    if (mediaUrl.startsWith('/api/image') && mediaUrl.includes('id=')) {
                        const urlObj = new URL(mediaUrl, `${protocol}://${host}`);
                        const id = urlObj.searchParams.get('id');
                        if (id) {
                            // Map type to extension for WhatsApp content-type hint
                            const extMap = { image: '.jpg', video: '.mp4', audio: '.mp3', document: '.pdf' };
                            const ext = extMap[type] || '';
                            absoluteUrl = `${protocol}://${host}/api/media/${id}${ext}`;
                        }
                    } else if (mediaUrl.startsWith('/')) {
                        // Any other relative URL → make absolute
                        absoluteUrl = `${protocol}://${host}${mediaUrl}`;
                    }

                    deliveryContent = absoluteUrl;
                }


                const cleanTo = candidate.whatsapp.replace(/\D/g, '');
                
                const extraParams = {};
                if (replyToId) extraParams.referenceId = replyToId;

                if (type === 'template') {
                    const tData = req.body.templateData;
                    const candidateNameFallback = String(candidate.nombreReal || candidate.nombre || 'Buen día').trim();
                    extraParams.templateName = tData.name;
                    extraParams.languageCode = tData.language || 'es_MX';
                    extraParams.components = [
                        { type: "body", parameters: [{ type: "text", text: candidateNameFallback }] }
                    ];
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, contentToSave, 'template', extraParams);
                } else if (type === 'text') {
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, finalMessage, 'chat', extraParams);
                } else {
                    extraParams.caption = finalMessage;
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, deliveryContent, type, extraParams);
                }

                if (sendResult) {
                    if (sendResult.success) {
                        // PERSIST TO REDIS
                        await updateCandidate(candidateId, {
                            ultimoMensajeBot: timestamp,
                            lastBotMessageAt: timestamp,
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
        console.error('Chat API Error:', error);
        return res.status(500).json({ error: 'Error interno', details: error.message });
    }
}
