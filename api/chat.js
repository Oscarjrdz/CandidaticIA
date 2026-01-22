/**
 * Endpoint para el Chat con Candidatos
 * GET /api/chat?candidateId=... (Obtener historial)
 * POST /api/chat (Enviar mensaje)
 */

import { getMessages, saveMessage, getCandidateById } from './utils/storage.js';
import { sendTestMessage } from '../src/services/builderbot.js';
import { substituteVariables } from './utils/shortcuts.js';

// NOTA: Para usar sendTestMessage en el backend, necesitamos adaptar la importación o replicar la lógica
// ya que builderbot.js usa sintaxis de frontend (fetch) que funciona en Node 18+, pero el path puede ser un problema.
// Por simplicidad, replicaremos la función de envío aquí para asegurar compatibilidad server-side.

const BUILDERBOT_API_URL = 'https://app.builderbot.cloud/api/v2';

const sendBuilderBotMessage = async (botId, apiKey, number, message) => {
    console.log('🚀 [sendBuilderBotMessage] Sending:', message);
    try {
        const response = await fetch(`${BUILDERBOT_API_URL}/${botId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': apiKey,
            },
            body: JSON.stringify({
                messages: {
                    type: "text",
                    content: message
                },
                number: number
            }),
        });

        const data = await response.json().catch(() => ({}));

        // BuilderBot v2 API structure might contain provider response
        if (!response.ok) {
            console.error('BuilderBot Error:', data);
            return { success: false, error: data };
        }
        return { success: true, data };
    } catch (error) {
        console.error('Network Error:', error);
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

            // Validar credenciales
            // Idealmente estas vendrían de una DB de configuración del usuario, 
            // pero por ahora las pasamos desde el frontend o usamos env vars
            const effectiveBotId = botId || process.env.BOT_ID; // Fallback a env si están seteadas
            const effectiveApiKey = apiKey || process.env.BOT_TOKEN;

            if (!effectiveBotId || !effectiveApiKey) {
                return res.status(400).json({ error: 'Credenciales de BuilderBot no proporcionadas' });
            }

            // Aplicar sustitución de shortcuts (ej: {{nombre}})
            const finalMessage = substituteVariables(message, candidate);

            // Enviar a BuilderBot
            const result = await sendBuilderBotMessage(effectiveBotId, effectiveApiKey, candidate.whatsapp, finalMessage);

            if (!result.success) {
                return res.status(502).json({ error: 'Error enviando a BuilderBot', details: result.error });
            }

            // Guardar en historial local como mensaje saliente
            const savedMsg = await saveMessage(candidateId, {
                from: 'me',
                content: finalMessage,
                type: 'text',
                timestamp: new Date().toISOString()
            });

            return res.status(200).json({ success: true, message: savedMsg });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error('Chat API Error:', error);
        return res.status(500).json({ error: 'Error interno', details: error.message });
    }
}
