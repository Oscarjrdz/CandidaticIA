import { getMessages, saveMessage, getCandidateById, updateCandidate, updateMessageStatus } from './utils/storage.js';
import { substituteVariables } from './utils/shortcuts.js';
import axios from 'axios';
import { sendUltraMsgMessage, getUltraMsgConfig } from './whatsapp/utils.js';

// BuilderBot legacy URLs removed as per UltraMsg migration.

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

        if (req.method === 'POST') {
            const { candidateId, message, type = 'text', mediaUrl, base64Data } = req.body;

            if (!candidateId || (!message && !mediaUrl)) {
                return res.status(400).json({ error: 'Faltan datos requeridos' });
            }

            const candidate = await getCandidateById(candidateId);
            if (!candidate) return res.status(404).json({ error: 'Candidato no encontrado' });

            const finalMessage = message ? substituteVariables(message, candidate) : '';
            const ultraConfig = await getUltraMsgConfig();

            if (!ultraConfig) return res.status(400).json({ error: 'Faltan credenciales' });

            const timestamp = new Date().toISOString();
            const msgId = `msg_${Date.now()}`;

            // 1. Transactional Save
            const msgToSave = {
                id: msgId,
                from: 'me',
                content: finalMessage,
                type: type,
                mediaUrl: mediaUrl,
                status: 'queued',
                timestamp: timestamp
            };

            await saveMessage(candidateId, msgToSave);

            // 2. Send via UltraMsg
            try {
                let sendResult;
                let deliveryContent = base64Data || mediaUrl;

                // Ensure absolute URL for relative paths (for images/video)
                if (mediaUrl && mediaUrl.includes('id=')) {
                    const protocol = req.headers['x-forwarded-proto'] || 'http';
                    const host = req.headers.host;

                    // For voice notes, Base64 is much more reliable than URL-fetching on Vercel
                    if (type === 'voice' && base64Data) {
                        deliveryContent = base64Data;
                        console.log(`📡 [Chat] Using DIRECT BASE64 for voice note (avoiding crawl issues)`);
                    } else {
                        // For images and other media, use the clean static-like URL
                        const urlObj = new URL(mediaUrl, `${protocol}://${host}`);
                        const id = urlObj.searchParams.get('id');
                        if (id) {
                            const ext = type === 'video' ? '.mp4' : '.jpg';
                            deliveryContent = `${protocol}://${host}/api/media/${id}${ext}`;
                            console.log(`🌐 [Chat] URL delivery for ${type}: ${deliveryContent}`);
                        }
                    }
                }

                if (base64Data) {
                    console.log(`📦 [Chat] BASE64 PAYLOAD: Size=${Math.round(base64Data.length / 1024)}KB | Samples=${base64Data.substring(0, 50)}...`);
                }

                console.log(`📡 [Chat] DELIVERY REQUEST: Type=${type} | FinalURL=${deliveryContent ? (deliveryContent.startsWith('http') ? deliveryContent : 'BASE64') : 'NONE'}`);

                const cleanTo = candidate.whatsapp.replace(/\D/g, '');
                console.log(`📡 [Chat] Sending to cleaned number: ${cleanTo}`);

                if (type === 'text') {
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, finalMessage, 'chat');
                } else {
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, deliveryContent, type, {
                        caption: finalMessage
                    });
                }

                if (sendResult) {
                    console.log(`📡 [Chat] UltraMSG Result for ${candidate.whatsapp}:`, JSON.stringify(sendResult));

                    if (sendResult.sent === 'true' || sendResult.id) {
                        // PERSIST TO REDIS
                        await updateCandidate(candidateId, {
                            ultimoMensajeBot: timestamp,
                            lastBotMessageAt: timestamp
                        });

                        // Update the message in the Redis list
                        const updatedData = {
                            status: 'sent',
                            ultraMsgId: sendResult.id
                        };
                        await updateMessageStatus(candidateId, msgToSave.id, 'sent', updatedData);

                        msgToSave.status = 'sent';
                        msgToSave.ultraMsgId = sendResult.id;
                    } else {
                        throw new Error(`UltraMSG Error: ${sendResult.message || JSON.stringify(sendResult)}`);
                    }
                }
            } catch (sendErr) {
                console.error('❌ Error sending via UltraMsg:', sendErr.message);
                await updateMessageStatus(candidateId, msgToSave.id, 'failed', { error: sendErr.message });
                msgToSave.status = 'failed';
            }

            // Update candidate last activity timestamps globally
            await updateCandidate(candidateId, {
                ultimoMensaje: timestamp
            });

            return res.status(200).json({ success: true, message: msgToSave });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error('Chat API Error:', error);
        return res.status(500).json({ error: 'Error interno', details: error.message });
    }
}
