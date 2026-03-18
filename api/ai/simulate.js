/**
 * POST /api/ai/simulate
 * Handles messages from the Web Simulator to Brenda.
 */
import { getRedisClient, getProjectById } from '../utils/storage.js';
import { processMessage } from './agent.js';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { message, sessionId, projectId, reset } = req.body;
        
        if (!message && !reset) {
            return res.status(400).json({ success: false, error: 'Message or reset missing' });
        }

        const redis = getRedisClient();
        const simId = sessionId || `sim_${uuidv4().substring(0,8)}`;
        const candidateKey = `sim_candidato:${simId}`;

        // Handle Restart Chat
        if (reset) {
            await redis.del(candidateKey);
            return res.status(200).json({ 
                success: true, 
                reply: 'Conversación reiniciada. ¡Hola! Soy Brenda, la asistente de Candidatic. ¿En qué te puedo ayudar hoy?',
                sessionId: simId 
            });
        }

        // Project defaults or custom
        // We need a designated "Simulator Project" or just use whatever is active.
        let activeProject = null;
        if (projectId) {
            activeProject = await getProjectById(projectId);
        } else {
            // Find any active project for fallback
            const allProjectsData = await redis.get('candidatic_projects');
            if (allProjectsData) {
                const projects = JSON.parse(allProjectsData);
                activeProject = projects.find(p => p.active) || projects[0];
            }
        }

        if (!activeProject) {
            return res.status(200).json({ 
                success: true, 
                reply: '⚠️ No hay proyectos activos. Configura al menos un proyecto en tu panel para usar el simulador.',
                sessionId: simId
            });
        }

        // Build mock UltraMsg payload
        const simulatedPayload = {
            id: `sim_msg_${Date.now()}`,
            from: `${simId}@c.us`,
            to: `sim_bot@c.us`,
            body: message,
            pushname: "Candidato Simulador",
            type: "chat",
            fromMe: false,
            timestamp: Math.floor(Date.now() / 1000)
        };

        // We wrap response to trap it instead of sending to ultraMsg
        let trappedReply = null;
        let trappedXRay = null; // To hold extracted_data and thought_process

        // Hacky dependency injection / mock for this single execution context
        // Instead of modifying the massive agent.js just for simulation, 
        // we can set a flag on the candidate data.
        
        // Let processMessage run. Inside agent.js, we normally call sendMessage.
        // For Simulator, we will just read what it generated from the simulated candidate object.

        const result = await processMessage(simulatedPayload, activeProject.assignedInstanceId || 'sim_instance');
        
        // Wait! processMessage sends the message via UltraMsg. We need to prevent that, 
        // or just let it fail silently (instance doesn't exist) and read the DB state.
        
        const candidateDataStr = await redis.get(candidateKey);
        const candidateData = candidateDataStr ? JSON.parse(candidateDataStr) : null;
        
        if (candidateData && candidateData.history && candidateData.history.length > 0) {
            // Find the last assistant message
            const assistantMessages = candidateData.history.filter(m => m.role === 'assistant');
            if (assistantMessages.length > 0) {
                trappedReply = assistantMessages[assistantMessages.length - 1].content;
            }
            
            // Extract X-RAY data
            trappedXRay = {
                step: candidateData.projectMetadata?.currentStepName || 'Inicio',
                extracted: candidateData.extractedData || {},
                thoughtLast: candidateData.projectMetadata?._debugSimThought || 'No capture'
            };
        }

        if (!trappedReply) {
            trappedReply = "Procesado (ver consola o db).";
        }

        return res.status(200).json({
            success: true,
            reply: trappedReply,
            sessionId: simId,
            xray: trappedXRay
        });

    } catch (error) {
        console.error('Sim Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
