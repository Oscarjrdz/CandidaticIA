import { getMessages, saveMessage, getCandidateById, updateCandidate } from './utils/storage.js';
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

        // POST - Enviar mensaje
        if (req.method === 'POST') {
            const { candidateId, message, botId, apiKey } = req.body;

            if (!candidateId || !message) {
                return res.status(400).json({ error: 'Faltan datos requeridos (candidateId, message)' });
            }

            // Obtener candidato para saber su número
            const candidate = await getCandidateById(candidateId);
            if (!candidate) {
                return res.status(404).json({ error: 'Candidato no encontrado' });
            }

            // Aplicar sustitución de shortcuts (ej: {{nombre}})
            const finalMessage = substituteVariables(message, candidate);

            // ALWAYS use UltraMsg (Candidatic 2.0)
            const ultraConfig = await getUltraMsgConfig();

            if (ultraConfig) {
                console.log(`📤 [Chat API] Sending via UltraMsg to ${candidate.whatsapp}`);

                // Enviar a UltraMsg
                const result = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, candidate.whatsapp, finalMessage);

                // Check for UltraMsg errors (sometimes they return success but "sent": "false" or similar)
                if (!result) {
                    console.error('❌ UltraMsg API returned null/undefined');
                    return res.status(502).json({ error: 'Error enviando a UltraMsg (Sin respuesta)' });
                }

                // If needed, check specific UltraMsg properties
                // but usually if it returns object it's "queued"
            } else {
                console.error('❌ UltraMsg Config Missing');
                return res.status(400).json({ error: 'Faltan credenciales de UltraMsg/Bot IA' });
            }

            // Guardar en historial local como mensaje saliente
            const timestamp = new Date().toISOString();
            const savedMsg = await saveMessage(candidateId, {
                from: 'me',
                content: finalMessage,
                type: 'text',
                timestamp: timestamp
            });

            // Actualizar estado del candidato para disparar el exportador (cron)
            await updateCandidate(candidateId, {
                ultimoMensaje: timestamp,
                ultimoMensajeBot: timestamp,
                lastBotMessageAt: timestamp
            });

            return res.status(200).json({ success: true, message: savedMsg });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error('Chat API Error:', error);
        return res.status(500).json({ error: 'Error interno', details: error.message });
    }
}
