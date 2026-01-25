import { getMessages, saveMessage, getCandidateById, updateCandidate, updateMessageStatus } from './utils/storage.js';
import { substituteVariables } from './utils/shortcuts.js';
import axios from 'axios';
import { sendUltraMsgMessage, getUltraMsgConfig } from './whatsapp/utils.js';

const BUILDERBOT_API_URL = 'https://app.builderbot.cloud/api/v2';

const sendBuilderBotMessage = async (botId, apiKey, number, message) => {
    console.log(`🚀 [sendBuilderBotMessage] Sending to ${number}...`);
    // Redacted logs for debugging
    console.log(`📍 BotId: ${botId ? 'PRESENT' : 'MISSING'}`);
    console.log(`🔑 ApiKey: ${apiKey ? (apiKey.substring(0, 5) + '...') : 'MISSING'}`);

    try {
        const url = `${BUILDERBOT_API_URL}/${botId}/messages`;
        const response = await axios.post(url, {
            messages: {
                type: "text",
                content: message
            },
            number: number,
            checkIfExists: false
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': apiKey,
            },
            validateStatus: () => true // Handle errors manually
        });

        console.log(`📥 BuilderBot Response: ${response.status} ${response.statusText}`);

        if (response.status !== 200 && response.status !== 201) {
            console.error('❌ BuilderBot Error Data:', response.data);
            return {
                success: false,
                error: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
                status: response.status
            };
        }

        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Network Error sending to BuilderBot:', error.message);
        return { success: false, error: error.message };
    }
};

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
                const deliveryContent = base64Data || mediaUrl;

                if (type === 'text') {
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, candidate.whatsapp, finalMessage, 'chat');
                } else {
                    sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, candidate.whatsapp, deliveryContent, type, {
                        caption: finalMessage
                    });
                }

                if (sendResult && (sendResult.sent === 'true' || sendResult.id)) {
                    // PERSIST TO REDIS: Important fix
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
