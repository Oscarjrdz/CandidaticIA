/**
 * POST /api/ai/simulate
 * Handles messages from the Web Simulator to Brenda.
 */
import { getRedisClient, getCandidateByPhone, saveCandidate, deleteCandidate, saveWebhookTransaction, getRecentMessages } from '../utils/storage.js';
import { processMessage } from './agent.js';

export default async function handler(req, res) {
    const phone = '5211234567890'; 
    const redis = getRedisClient();

    // ---- GET: Fetch Simulator History ----
    if (req.method === 'GET') {
        try {
            let candidate = await getCandidateByPhone(phone);
            if (!candidate) {
                return res.status(200).json({ success: true, messages: [] });
            }
            // Fetch messages from DB for this candidate
            const msgs = await getRecentMessages(candidate.id, 50);
            
            // Format to UI structure
            const uiMessages = msgs.map(m => {
                const isUser = m.from === 'user' || m.from === 'me';
                const content = typeof m === 'string' ? m : (m.content || m.body || '');
                return {
                    id: m.id || Date.now() + Math.random(),
                    sender: isUser ? 'user' : 'bot',
                    text: content.replace(/\[MSG_SPLIT\]/g, '\n'),
                    time: new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                };
            });

            return res.status(200).json({ success: true, messages: uiMessages });
        } catch (e) {
            console.error('Sim GET Error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    // ---- POST / DELETE ----
    if (req.method !== 'POST' && req.method !== 'DELETE') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const reset = req.body?.reset || req.method === 'DELETE';
        const message = req.body?.message;
        
        // Handle Restart Chat
        if (reset) {
            const cand = await getCandidateByPhone(phone);
            if (cand) {
                // Wipe candidate from DB completely
                await deleteCandidate(cand.id);
                await redis.del(`messages:${cand.id}`);
                await redis.del(`reengagement:${cand.id}`);
                await redis.del(`noInteresa:${cand.id}`);
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
                // Removed 'nombreReal: Candidato Simulador' so the AI will ask for it normally
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
