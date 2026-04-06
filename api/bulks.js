import { getCandidateById, saveMessage, updateCandidate, updateMessageStatus } from './utils/storage.js';
import { substituteVariables } from './utils/shortcuts.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from './whatsapp/utils.js';
import axios from 'axios';
import { getRedisClient } from './utils/storage.js';
import { getCachedConfig } from './utils/cache.js';

// En memoria RAM (Solo funcionará perfecto en persistencia como Railway o Local)
let bulkState = {
    isRunning: false,
    isAborted: false,
    candidates: [],
    messages: [],
    minDelay: 3,
    maxDelay: 5,
    pauseEvery: 10,
    pauseFor: 10,
    currentIndex: 0,
    currentCandidateIndex: 0,
    totalSent: 0,
    logs: [],
    campaignId: null,
    campaignName: null
};

// Variable para el temporizador
let bulkQueueTimer = null;

const syncStateToRedis = async () => {
    try {
        const redis = getRedisClient();
        if (redis) {
            await redis.set('bulks:latest_state', JSON.stringify(bulkState));
            // Update history if it's a saved campaign
            if (bulkState.campaignId) {
                const res = await redis.get('bulks:history');
                let history = [];
                if (res) history = typeof res === 'string' ? JSON.parse(res) : res;
                
                const index = history.findIndex(h => h.id === bulkState.campaignId);
                if (index !== -1) {
                    history[index].totalSent = bulkState.totalSent;
                    if (bulkState.isRunning) history[index].status = 'running';
                    else if (bulkState.isAborted) history[index].status = 'aborted';
                    else history[index].status = 'completed';
                    
                    await redis.set('bulks:history', JSON.stringify(history));
                }
            }
        }
    } catch (e) {
        console.error('Error saving bulk state to redis', e);
    }
};

const tryRecoverState = async () => {
    try {
        const redis = getRedisClient();
        if (redis) {
            const saved = await redis.get('bulks:latest_state');
            if (saved) {
                const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
                // Si el motor dice estar corriendo pero no hay temporizador (ej. reinicio de app),
                // lo marcamos como abortado o detenido por caída.
                if (parsed.isRunning && !bulkQueueTimer) {
                    parsed.isRunning = false;
                    parsed.logs.unshift(`[${new Date().toLocaleTimeString()}] ⚠️ El servidor se reinició. Envío detenido en el contacto ${parsed.currentCandidateIndex}.`);
                }
                bulkState = parsed;
            }
        }
    } catch (e) {
        console.error('Error recovering bulk state from redis', e);
    }
};

// Intentar recuperar al cargar el módulo
tryRecoverState();

const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    bulkState.logs.unshift(`[${timestamp}] ${msg}`);
    if (bulkState.logs.length > 50) bulkState.logs.pop(); // Keep only 50 logs
    syncStateToRedis();
};

const sendNextMessage = async () => {
    if (bulkState.isAborted || !bulkState.isRunning) {
        bulkState.isRunning = false;
        return;
    }

    if (bulkState.currentCandidateIndex >= bulkState.candidates.length) {
        addLog('✅ Envío masivo completado.');
        bulkState.isRunning = false;
        return;
    }

    const candidateId = bulkState.candidates[bulkState.currentCandidateIndex];
    const messageTemplate = bulkState.messages[bulkState.currentIndex];

    addLog(`⏳ Procesando candidato ${candidateId} - Mensaje ${bulkState.currentIndex + 1}/${bulkState.messages.length}`);

    // --- LOGICA DE ENVIO Y WA ---
    try {
        const candidate = await getCandidateById(candidateId);
        if (candidate) {
            const finalMessage = substituteVariables(messageTemplate, candidate);
            const ultraConfig = await getUltraMsgConfig(candidate?.instanceId);

            if (ultraConfig) {
                const timestamp = new Date().toISOString();
                const msgId = `msg_bulk_${Date.now()}`;
                
                // Simular typing (Opcional, UltraMsg lo soporta con un endpoint distinto, pero lo omitiremos para no sobrecargar el api, a menos que el delay sea la pausa)
                // Aquí podríamos llamar un endpoint de presencia, como la API original que usa el chat: `sendUltraMsgMessage(..., 'chat')`
                
                const cleanTo = candidate.whatsapp.replace(/\D/g, '');
                
                // 1. Transactional Save
                const msgToSave = {
                    id: msgId,
                    from: 'me',
                    content: finalMessage,
                    type: 'text',
                    status: 'queued',
                    timestamp: timestamp
                };

                await saveMessage(candidateId, msgToSave);

                // 2. Send via UltraMsg
                const sendResult = await sendUltraMsgMessage(ultraConfig.instanceId, ultraConfig.token, cleanTo, finalMessage, 'chat');

                if (sendResult && sendResult.success) {
                    await updateCandidate(candidateId, {
                        ultimoMensajeBot: timestamp,
                        lastBotMessageAt: timestamp,
                        ultimoMensaje: timestamp
                    });

                    const remoteId = sendResult.data?.id || sendResult.data?.messageId;
                    await updateMessageStatus(candidateId, msgToSave.id, 'sent', { status: 'sent', ultraMsgId: remoteId });
                    addLog(`🟢 Mensaje enviado a ${candidate.nombreReal || candidate.whatsapp}`);
                } else {
                    addLog(`🔴 Fila enviada pero UltraMsg retornó error para ${candidate.whatsapp}`);
                }
            } else {
                addLog(`🔴 Configuración de UltraMsg no encontrada para candidato ${candidateId}`);
            }
        }
    } catch (e) {
        addLog(`❌ Error procesando candidato ${candidateId}: ${e.message}`);
    }

    // --- MANEJO DE INDICES ---
    bulkState.totalSent++;
    bulkState.currentIndex++;

    // ¿Ya acabo sus mensajes este candidato?
    if (bulkState.currentIndex >= bulkState.messages.length) {
        bulkState.currentIndex = 0;
        bulkState.currentCandidateIndex++;
    }

    // ¿Toca descanso general?
    if (bulkState.totalSent % bulkState.pauseEvery === 0) {
        addLog(`☕ Descanso programado. Pausando por ${bulkState.pauseFor} minutos...`);
        syncStateToRedis();
        bulkQueueTimer = setTimeout(sendNextMessage, bulkState.pauseFor * 60 * 1000);
        return;
    }

    // Delay aleatorio normal
    const minDelayMs = bulkState.minDelay * 1000;
    const maxDelayMs = bulkState.maxDelay * 1000;
    const nextRandomDelay = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1) + minDelayMs);

    syncStateToRedis();
    bulkQueueTimer = setTimeout(sendNextMessage, nextRandomDelay);
};


export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.query;

    if (req.method === 'POST' && action === 'start') {
        if (bulkState.isRunning) {
            return res.status(400).json({ error: 'Ya hay un envío en curso. Aborta primero.' });
        }

        const { candidates, messages, minDelay, maxDelay, pauseEvery, pauseFor, campaignName } = req.body;
        
        if (!candidates?.length || !messages?.length) {
            return res.status(400).json({ error: 'Faltan candidatos o mensajes.' });
        }

        const campaignId = campaignName ? `camp_${Date.now()}` : null;

        bulkState = {
            isRunning: true,
            isAborted: false,
            candidates,
            messages,
            minDelay: Number(minDelay) || 3,
            maxDelay: Number(maxDelay) || 5,
            pauseEvery: Number(pauseEvery) || 10,
            pauseFor: Number(pauseFor) || 10,
            currentIndex: 0,
            currentCandidateIndex: 0,
            totalSent: 0,
            logs: [],
            campaignId,
            campaignName
        };

        if (campaignId) {
            try {
                const redis = getRedisClient();
                if (redis) {
                    let history = [];
                    const resApi = await redis.get('bulks:history');
                    if (resApi) history = typeof resApi === 'string' ? JSON.parse(resApi) : resApi;
                    
                    history.unshift({
                        id: campaignId,
                        name: campaignName,
                        date: new Date().toISOString(),
                        messages,
                        minDelay, maxDelay, pauseEvery, pauseFor,
                        totalTargets: candidates.length,
                        totalSent: 0,
                        status: 'running'
                    });
                    await redis.set('bulks:history', JSON.stringify(history));
                }
            } catch(e) {}
        }

        addLog(`🚀 Iniciando cola masiva para ${candidates.length} contactos...`);
        syncStateToRedis();
        
        if (bulkQueueTimer) clearTimeout(bulkQueueTimer);
        
        // Empezar en 2 segundos el primero
        bulkQueueTimer = setTimeout(sendNextMessage, 2000);

        return res.status(200).json({ success: true, message: 'Bulk started', state: bulkState });
    }

    if (req.method === 'POST' && action === 'abort') {
        bulkState.isRunning = false;
        bulkState.isAborted = true;
        if (bulkQueueTimer) clearTimeout(bulkQueueTimer);
        addLog('🛑 Envío masivo ABORTADO por el usuario.');
        syncStateToRedis();
        return res.status(200).json({ success: true, message: 'Bulk aborted' });
    }

    if (req.method === 'GET' && action === 'status') {
        // En caso de que se haya reiniciado la app y sea la primera petición, tratamos de recuperar si bulkState es por defecto
        if (!bulkState.candidates || bulkState.candidates.length === 0) {
            await tryRecoverState();
        }
        return res.status(200).json({ success: true, state: bulkState });
    }

    if (req.method === 'POST' && action === 'save_draft') {
        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.set('bulks:draft', JSON.stringify(req.body));
            }
            return res.status(200).json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: 'Failed saving draft to redis' });
        }
    }

    if (req.method === 'GET' && action === 'get_draft') {
        try {
            const redis = getRedisClient();
            if (redis) {
                const draft = await redis.get('bulks:draft');
                if (draft) {
                    return res.status(200).json({ success: true, draft: typeof draft === 'string' ? JSON.parse(draft) : draft });
                }
            }
        } catch (e) {}
        return res.status(200).json({ success: false });
    }

    if (req.method === 'GET' && action === 'history_list') {
        try {
            const redis = getRedisClient();
            if (redis) {
                const history = await redis.get('bulks:history');
                return res.status(200).json({ success: true, history: history ? (typeof history === 'string' ? JSON.parse(history) : history) : [] });
            }
        } catch (e) {
            return res.status(500).json({ error: 'Failed getting history' });
        }
        return res.status(200).json({ success: true, history: [] });
    }

    if (req.method === 'POST' && action === 'history_delete') {
        try {
            const { id } = req.body;
            const redis = getRedisClient();
            if (redis) {
                const resApi = await redis.get('bulks:history');
                let history = [];
                if (resApi) history = typeof resApi === 'string' ? JSON.parse(resApi) : resApi;
                history = history.filter(h => h.id !== id);
                await redis.set('bulks:history', JSON.stringify(history));
                return res.status(200).json({ success: true });
            }
        } catch (e) {}
        return res.status(500).json({ error: 'Failed deleting history' });
    }

    if (req.method === 'POST' && action === 'clone_ai') {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Falta texto a clonar' });

        try {
            const redis = getRedisClient();
            let apiKey = process.env.OPENAI_API_KEY;

            if (redis) {
                const aiConfigJson = await getCachedConfig(redis, 'ai_config') || await redis.get('ai_config');
                if (aiConfigJson) {
                    const aiConfig = typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson;
                    if (aiConfig.openaiApiKey) apiKey = aiConfig.openaiApiKey;
                }
            }

            if (!apiKey) {
                return res.status(500).json({ error: 'No OpenAI API Key found' });
            }

            const prompt = `Re-escribe el siguiente mensaje utilizando sinónimos, cambiando sutilmente la estructura para que parezca escrito por una persona natural. 
MANTÉN EL MISMO CONTEXTO, LA MISMA AMIGABILIDAD, y la longitud muy similar. 
Asegúrate de incluir EMOJIS variados (diferentes a los originales si los había, o agrégalos si no).
ESTE TEXTO RE-ESCRITO SE ENVIARÁ POR WHATSAPP, POR LO QUE NO SALUDES TÚ NI DIGAS "Aquí tienes tu texto". ÚNICAMENTE entrega el mensaje final que se mandará.

TEXTO ORIGINAL:
"${text}"
`;

            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-4o-mini',
                messages: [{ role: 'system', content: prompt }],
                temperature: 0.8,
                max_tokens: 300
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            const rewritten = response.data.choices[0].message.content.trim();
            return res.status(200).json({ success: true, result: rewritten });

        } catch (error) {
            console.error('Clone AI Error', error.message);
            return res.status(500).json({ error: 'No se pudo generar con IA' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
