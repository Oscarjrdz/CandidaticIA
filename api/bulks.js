import { getCandidateById, saveMessage, updateCandidate, updateMessageStatus } from './utils/storage.js';
import { substituteVariables } from './utils/shortcuts.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from './whatsapp/utils.js';
import axios from 'axios';
import { getRedisClient } from './utils/storage.js';
import { getCachedConfig } from './utils/cache.js';

// ═══════════════════════════════════════════════════════════════════════════════
// POLL-DRIVEN BULK ENGINE v2.0
// ═══════════════════════════════════════════════════════════════════════════════
// Diseñado para sobrevivir en entornos serverless (Vercel) y persistentes (Railway).
//
// PRINCIPIO: El estado vive 100% en Redis. Cada call a GET ?action=status
//            es el "tick" que avanza la cola si ya pasó el delay.
//            No hay setTimeout, no hay setInterval, no hay RAM persistente.
//
// FLUJO:
//   1. POST ?action=start   → Escribe estado inicial en Redis con isRunning:true
//   2. GET  ?action=status   → Lee Redis. Si isRunning && Date.now() >= nextSendAt
//                               → ejecuta sendNextMessage() inline, actualiza Redis
//   3. POST ?action=abort    → Escribe isAborted:true en Redis. Siguiente tick lo detecta.
//
// ANTI-SPAM: Los delays aleatorios se precomputan como timestamps absolutos
//            (nextSendAt). Los descansos de seguridad también.
// ═══════════════════════════════════════════════════════════════════════════════

const REDIS_KEY_STATE = 'bulks:engine_state';
const REDIS_KEY_DRAFT = 'bulks:draft';
const REDIS_KEY_HISTORY = 'bulks:history';

// Lock para evitar que 2 polls concurrentes procesen al mismo candidato
let processingLock = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getState = async () => {
    try {
        const redis = getRedisClient();
        if (!redis) return null;
        const raw = await redis.get(REDIS_KEY_STATE);
        if (!raw) return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
        console.error('[BULK ENGINE] Error reading state from Redis:', e.message);
        return null;
    }
};

const saveState = async (state) => {
    try {
        const redis = getRedisClient();
        if (!redis) return;
        await redis.set(REDIS_KEY_STATE, JSON.stringify(state));

        // Sync to history if campaign has an ID
        if (state.campaignId) {
            try {
                const raw = await redis.get(REDIS_KEY_HISTORY);
                let history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
                const idx = history.findIndex(h => h.id === state.campaignId);
                if (idx !== -1) {
                    history[idx].totalSent = state.totalSent;
                    history[idx].status = state.isRunning ? 'running' : (state.isAborted ? 'aborted' : 'completed');
                    await redis.set(REDIS_KEY_HISTORY, JSON.stringify(history));
                }
            } catch (e) { /* non-critical */ }
        }
    } catch (e) {
        console.error('[BULK ENGINE] Error saving state to Redis:', e.message);
    }
};

const addLog = (state, msg) => {
    const ts = new Date().toLocaleTimeString();
    state.logs.unshift(`[${ts}] ${msg}`);
    if (state.logs.length > 80) state.logs.length = 80; // cap
};

// Delays eliminados por blast logic

// ─── Core Tick Engine ────────────────────────────────────────────────────────

const tickEngine = async (state) => {
    // Gate 1: no está corriendo
    if (!state || !state.isRunning) return state;

    // Gate 2: fue abortado
    if (state.isAborted) {
        state.isRunning = false;
        addLog(state, '🛑 Envío masivo ABORTADO por el usuario.');
        await saveState(state);
        return state;
    }

    // Gate 3: ya terminó todos los candidatos
    if (state.currentCandidateIndex >= state.candidates.length) {
        state.isRunning = false;
        addLog(state, '✅ Envío masivo completado. Todos los contactos procesados.');
        await saveState(state);
        return state;
    }

    // Gate 4: lock — otro tick ya está procesando
    if (processingLock) return state;
    processingLock = true;

    try {
        let sentInTick = 0;
        const BATCH_SIZE = 25;

        while (sentInTick < BATCH_SIZE && state.currentCandidateIndex < state.candidates.length && state.isRunning && !state.isAborted) {
            // ─── ENVIAR MENSAJE ──────────────────────────────────────────────────
            const candidateId = state.candidates[state.currentCandidateIndex];

            // Selección aleatoria de variante (o única si solo hay 1)
            const randomIdx = Math.floor(Math.random() * (state.messages?.length || 1));
            const messageTemplate = state.messages?.[randomIdx] || '';

            addLog(state, `🚀 Enviando ${state.currentCandidateIndex + 1}/${state.candidates.length}...`);

            let sendSuccess = false;

        try {
            const candidate = await getCandidateById(candidateId);
            if (!candidate) {
                addLog(state, `⚠️ Candidato ${candidateId} no encontrado en DB. Saltando.`);
            } else {
                const finalMessage = state.bulkType === 'template' ? '' : substituteVariables(messageTemplate, candidate);
                const ultraConfig = await getUltraMsgConfig();

                if (!ultraConfig) {
                    addLog(state, `🔴 Sin config UltraMsg para ${candidateId}. Saltando.`);
                } else {
                        const cleanTo = (candidate.whatsapp || '').replace(/\D/g, '');
                        if (!cleanTo) {
                            addLog(state, `🔴 WhatsApp vacío para ${candidate.nombreReal || candidateId}. Saltando.`);
                        } else {
                            const timestamp = new Date().toISOString();
                            const msgId = `msg_bulk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

                            let msgToSaveStr = finalMessage;
                            let sendType = 'text';
                            let extraParams = {};

                            // ── TEMPLATE MODE ──
                            if (state.bulkType === 'template' && state.templateData) {
                                const templateName = state.templateData.name;
                                const languageCode = state.templateData.language || 'es_MX';
                                
                                // Fallback de nombre ("Buen día" en caso de vacío)
                                const candidateNameFallback = String(candidate.nombreReal || candidate.nombre || 'Buen día').trim();
                                
                                extraParams = {
                                    templateName,
                                    languageCode
                                };
                                
                                // Construcción dinámica de componentes
                                const componentsToSend = [];
                                (state.templateData.components || []).forEach(comp => {
                                    const cType = (comp.type || '').toLowerCase();
                                    
                                    if (cType === 'body' || cType === 'header') {
                                        if (cType === 'body' || (comp.format || '').toLowerCase() === 'text') {
                                            const textInfo = comp.text || '';
                                            const varMatches = textInfo.match(/\{\{[^}]+\}\}/g) || [];
                                            let expectedCount = [...new Set(varMatches)].length;
                                            
                                            // Source of truth from Meta's parsed examples
                                            if (cType === 'body' && comp.example?.body_text?.[0]) {
                                                expectedCount = comp.example.body_text[0].length;
                                            } else if (cType === 'header' && comp.example?.header_text) {
                                                expectedCount = comp.example.header_text.length;
                                            }

                                            if (expectedCount > 0) {
                                                const params = Array(expectedCount).fill(0).map((_, pIdx) => {
                                                    // Use custom param if provided, else fallback to candidate name
                                                    const paramKey = String(pIdx + 1);
                                                    const customVal = state.templateParams?.[paramKey];
                                                    return { type: "text", text: customVal || candidateNameFallback };
                                                });
                                                componentsToSend.push({
                                                    type: cType,
                                                    parameters: params
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
                                                const mUrl = placeholders[format] || placeholders.image;
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
                                
                                sendType = 'template';
                                let realText = '';
                                const bodyComp = (state.templateData.components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
                                if (bodyComp && bodyComp.text) {
                                    realText = bodyComp.text.replace(/\{\{[^}]+\}\}/g, (match) => {
                                        // Extract the var key — could be numeric "1" or named "categoriavac"
                                        const varKey = match.replace(/[{}]/g, '');
                                        // Try numeric key first ("1"), then named key
                                        return state.templateParams?.[varKey] || state.templateParams?.['1'] || candidateNameFallback;
                                    });
                                }
                                const displayName = templateName.replace(/_/g, ' ');
                                msgToSaveStr = `⚡ Plantilla masiva: *${displayName}*\n\n${realText}`.trim();
                            }

                            // 1. Guardar mensaje transaccional
                            const msgToSave = {
                                id: msgId,
                                from: 'me',
                                content: msgToSaveStr,
                                type: sendType === 'template' ? 'template' : 'text',
                                status: 'queued',
                                timestamp
                            };
                            if (state.campaignId) {
                                msgToSave.campaignId = state.campaignId;
                            }
                            await saveMessage(candidateId, msgToSave);

                            // 2. Enviar via WhatsApp (Cloud API maneja 'template' nativamente)
                            const sendResult = await sendUltraMsgMessage(
                                ultraConfig.instanceId,
                                ultraConfig.token,
                                cleanTo,
                                msgToSaveStr,
                                sendType,
                                extraParams
                            );

                            if (sendResult && sendResult.success) {
                                await updateCandidate(candidateId, {
                                    ultimoMensajeBot: timestamp,
                                    lastBotMessageAt: timestamp,
                                    ultimoMensaje: timestamp
                                });
                                const remoteId = sendResult.data?.id || sendResult.data?.messageId;
                                await updateMessageStatus(candidateId, msgToSave.id, 'sent', {
                                    status: 'sent',
                                    ultraMsgId: remoteId
                                });
                                addLog(state, `🟢 Enviado a ${candidate.nombreReal || candidate.whatsapp}`);
                                sendSuccess = true;
                            } else {
                                addLog(state, `🔴 Error de API para ${candidate.whatsapp}: ${sendResult?.error || 'respuesta no exitosa'}`);
                                // Marcar como fallido
                                await updateMessageStatus(candidateId, msgToSave.id, 'failed', { status: 'failed' }).catch(() => {});
                            }
                        }
                    }
                }
            } catch (e) {
                addLog(state, `❌ Error procesando ${candidateId}: ${e.message}`);
            }

            // ─── AVANZAR ÍNDICE ──────────────────────────────────────────────────
            if (sendSuccess) state.totalSent++;
            state.currentCandidateIndex++;
            sentInTick++;

            // Wait 50ms before sending the next to briefly yield event loop
            await new Promise(r => setTimeout(r, 50));
        }

        // ¿Ya terminó todo el lote/campaña?
        if (state.currentCandidateIndex >= state.candidates.length) {
            state.isRunning = false;
            state.nextSendAt = null;
            addLog(state, '✅ Envío masivo completado. Todos los contactos procesados.');
        } else {
            // Continúa instantáneamente en el siguiente tick
            state.nextSendAt = Date.now();
        }

        await saveState(state);

    } finally {
        processingLock = false;
    }

    return state;
};


// ═══════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.query;

    // ─── START ───────────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'start') {
        const existingState = await getState();
        if (existingState && existingState.isRunning) {
            return res.status(400).json({ error: 'Ya hay un envío en curso. Aborta primero.' });
        }

        const { candidates, messages, bulkType, templateData, templateParams, minDelay, maxDelay, pauseEvery, pauseFor, campaignName } = req.body;

        if (!candidates?.length) {
            return res.status(400).json({ error: 'Faltan candidatos.' });
        }
        if (bulkType !== 'template' && !messages?.length) {
            return res.status(400).json({ error: 'Faltan mensajes para el envío libre.' });
        }
        if (bulkType === 'template' && !templateData?.name) {
            return res.status(400).json({ error: 'Falta configurar la plantilla a enviar.' });
        }

        const campaignId = `camp_${Date.now()}`;
        const displayName = campaignName || `Campaña ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;

        const newState = {
            isRunning: true,
            isAborted: false,
            bulkType: bulkType || 'text',
            templateData: templateData || null,
            templateParams: templateParams || null,
            candidates,
            messages: messages || [],
            minDelay: 0,
            maxDelay: 0,
            pauseEvery: 99999,
            pauseFor: 0,
            currentCandidateIndex: 0,
            totalSent: 0,
            logs: [],
            campaignId,
            campaignName: displayName,
            startedAt: Date.now(),
            nextSendAt: Date.now()
        };

        addLog(newState, `🚀 Campaña "${displayName}" iniciada para ${candidates.length} contactos.`);

        // Guardar campaña en historial (siempre — campaignId siempre existe)
        {
            try {
                const redis = getRedisClient();
                if (redis) {
                    const raw = await redis.get(REDIS_KEY_HISTORY);
                    let history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
                    history.unshift({
                        id: campaignId,
                        name: displayName,
                        date: new Date().toISOString(),
                        bulkType: newState.bulkType,
                        templateData: newState.templateData,
                        messages: newState.messages,
                        minDelay: newState.minDelay,
                        maxDelay: newState.maxDelay,
                        pauseEvery: newState.pauseEvery,
                        pauseFor: newState.pauseFor,
                        totalTargets: candidates.length,
                        totalSent: 0,
                        status: 'running'
                    });
                    await redis.set(REDIS_KEY_HISTORY, JSON.stringify(history));
                }
            } catch (e) { /* non-critical */ }
        }

        await saveState(newState);
        return res.status(200).json({ success: true, message: 'Bulk started', state: newState });
    }

    // ─── ABORT ───────────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'abort') {
        const state = await getState();
        if (!state) {
            return res.status(200).json({ success: true, message: 'No hay campaña activa.' });
        }

        state.isRunning = false;
        state.isAborted = true;
        state.nextSendAt = null;
        addLog(state, '🛑 Envío masivo ABORTADO por el usuario.');
        await saveState(state);

        return res.status(200).json({ success: true, message: 'Bulk aborted' });
    }

    // ─── CLEAR ───────────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'clear') {
        const redis = getRedisClient();
        if (redis) {
            await redis.del(REDIS_KEY_STATE);
        }
        return res.status(200).json({ success: true, message: 'Bulk state cleared' });
    }

    // ─── STATUS (+ TICK ENGINE) ──────────────────────────────────────────────
    if (req.method === 'GET' && action === 'status') {
        let state = await getState();

        if (!state) {
            // No hay estado — devolver estado vacío
            return res.status(200).json({
                success: true,
                state: {
                    isRunning: false,
                    isAborted: false,
                    candidates: [],
                    messages: [],
                    currentCandidateIndex: 0,
                    totalSent: 0,
                    logs: []
                }
            });
        }

        // 🔥 TICK: Si está corriendo, intentar avanzar la cola
        if (state.isRunning && !state.isAborted) {
            const redis = getRedisClient();
            let lockAcquired = false;
            
            if (redis) {
                const lock = await redis.set('bulk_lock', '1', 'EX', 10, 'NX');
                if (lock) lockAcquired = true;
            } else {
                // Si no hay redis, pasamos (aunque para este serverless es vital tenerlo)
                lockAcquired = true;
            }

            if (lockAcquired) {
                try {
                    state = await tickEngine(state);
                } finally {
                    if (redis) await redis.del('bulk_lock');
                }
            }
        }

        return res.status(200).json({ success: true, state });
    }

    // ─── SAVE DRAFT ──────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'save_draft') {
        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.set(REDIS_KEY_DRAFT, JSON.stringify(req.body));
            }
            return res.status(200).json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: 'Failed saving draft' });
        }
    }

    // ─── GET DRAFT ───────────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'get_draft') {
        try {
            const redis = getRedisClient();
            if (redis) {
                const raw = await redis.get(REDIS_KEY_DRAFT);
                if (raw) {
                    return res.status(200).json({
                        success: true,
                        draft: typeof raw === 'string' ? JSON.parse(raw) : raw
                    });
                }
            }
        } catch (e) { /* non-critical */ }
        return res.status(200).json({ success: false });
    }

    // ─── HISTORY LIST ────────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'history_list') {
        try {
            const redis = getRedisClient();
            if (redis) {
                const raw = await redis.get(REDIS_KEY_HISTORY);
                const history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
                return res.status(200).json({ success: true, history });
            }
        } catch (e) {
            return res.status(500).json({ error: 'Failed getting history' });
        }
        return res.status(200).json({ success: true, history: [] });
    }

    // ─── HISTORY STATS ───────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'history_stats') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Missing campaign ID' });
        try {
            const redis = getRedisClient();
            if (redis) {
                const raw = await redis.hgetall(`bulk_stats:${id}`);
                const stats = raw || { sent: 0, delivered: 0, read: 0 };
                return res.status(200).json({ success: true, stats });
            }
        } catch (e) {
            return res.status(500).json({ error: 'Failed getting history stats' });
        }
        return res.status(200).json({ success: true, stats: { sent: 0, delivered: 0, read: 0 } });
    }

    // ─── HISTORY DELETE ──────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'history_delete') {
        try {
            const { id } = req.body;
            const redis = getRedisClient();
            if (redis) {
                const raw = await redis.get(REDIS_KEY_HISTORY);
                let history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
                history = history.filter(h => h.id !== id);
                await redis.set(REDIS_KEY_HISTORY, JSON.stringify(history));
                return res.status(200).json({ success: true });
            }
        } catch (e) { /* non-critical */ }
        return res.status(500).json({ error: 'Failed deleting history' });
    }

    // ─── CLONE AI ────────────────────────────────────────────────────────────
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
