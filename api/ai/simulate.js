/**
 * POST /api/ai/simulate
 * Handles messages from the Web Simulator to Brenda.
 */
import { getRedisClient, getCandidateByPhone, saveCandidate, deleteCandidate, saveWebhookTransaction } from '../utils/storage.js';
import { processMessage } from './agent.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { message, reset } = req.body;
        
        // El usuario solicitó el número por defecto '1234567890'
        // USAMOS EL FORMATO MX 521 + 10 digitos para máxima compatibilidad con el engine principal
        const phone = '5211234567890'; 
        const redis = getRedisClient();

        // Handle Restart Chat
        if (reset) {
            const cand = await getCandidateByPhone(phone);
            if (cand) {
                await deleteCandidate(cand.id);
            }
            return res.status(200).json({ 
                success: true, 
                reply: 'Conversación reiniciada. ¡Hola! Soy Brenda, la asistente de Candidatic. ¿En qué te puedo ayudar hoy?',
                sessionId: phone 
            });
        }

        if (!message) {
            return res.status(400).json({ success: false, error: 'Message missing' });
        }

        // Obtener o Crear candidato
        let candidate = await getCandidateByPhone(phone);
        if (!candidate) {
            candidate = await saveCandidate({ 
                whatsapp: phone, 
                nombreReal: 'Candidato Simulador', 
                esNuevo: 'SI',
                primerContacto: new Date().toISOString()
            });
        }

        const msgId = `sim_msg_${Date.now()}`;
        const incomingMsgObj = { 
            id: msgId, 
            from: 'user', 
            content: message, 
            timestamp: new Date().toISOString() 
        };

        // Guardar el mensaje entrante y simular webhook para registro en BBDD real
        // Esto permite que el candidato 5211234567890 aparezca en el panel de control real
        await saveWebhookTransaction({
            candidateId: candidate.id,
            message: incomingMsgObj,
            statsType: 'incoming',
            eventData: { event_type: 'incoming_message', whatsapp: phone, text: message }
        });

        // Invocar directamente el cerebro principal (processMessage devuelve el texto de respuesta)
        const replyText = await processMessage(candidate.id, message, msgId);

        // Extraer X-Ray (Memoria y contexto para la UI del simulador)
        let trappedXRay = null;
        let finalReply = replyText;
        
        const candidateDataStr = await redis.get(`candidate:${candidate.id}`);
        const finalCandidateData = candidateDataStr ? JSON.parse(candidateDataStr) : null;
        
        if (finalCandidateData) {
            trappedXRay = {
                step: finalCandidateData.projectMetadata?.currentStepName || finalCandidateData.stepId || 'Inicio',
                extracted: finalCandidateData.extractedData || {},
                thoughtLast: finalCandidateData.projectMetadata?._debugSimThought || 'No capture'
            };
            
            // Si no obtuvimos reply texto directo, intentar sacarlo del historial
            if (!finalReply && finalCandidateData.history && finalCandidateData.history.length > 0) {
                const assistantMessages = finalCandidateData.history.filter(m => m.role === 'assistant');
                if (assistantMessages.length > 0) {
                    finalReply = assistantMessages[assistantMessages.length - 1].content;
                }
            }
        }

        return res.status(200).json({
            success: true,
            reply: finalReply || "Procesado (ver consola o db).",
            sessionId: phone,
            xray: trappedXRay
        });

    } catch (error) {
        console.error('Sim Error:', error);
        return res.status(500).json({ success: false, error: String(error) });
    }
}
