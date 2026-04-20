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

const computeNextDelay = (state) => {
    const minMs = (Number(state.minDelay) || 3) * 1000;
    const maxMs = (Number(state.maxDelay) || 7) * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
};

const computePauseDelay = (state) => {
    return (Number(state.pauseFor) || 10) * 60 * 1000; // minutos → ms
};

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

    // Gate 4: aún no toca (delay / pausa)
    if (state.nextSendAt && Date.now() < state.nextSendAt) {
        return state; // Aún no es hora, no guardar (no cambió nada)
    }

    // Gate 5: lock — otro tick ya está procesando
    if (processingLock) return state;
    processingLock = true;

    try {
        // ─── ENVIAR MENSAJE ──────────────────────────────────────────────────
        const candidateId = state.candidates[state.currentCandidateIndex];

        // Selección aleatoria de variante
        const randomIdx = Math.floor(Math.random() * state.messages.length);
        const messageTemplate = state.messages[randomIdx];

        addLog(state, `⏳ Procesando ${state.currentCandidateIndex + 1}/${state.candidates.length} — Variante #${randomIdx + 1}`);

        let sendSuccess = false;

        try {
            const candidate = await getCandidateById(candidateId);
            if (!candidate) {
                addLog(state, `⚠️ Candidato ${candidateId} no encontrado en DB. Saltando.`);
            } else {
                const finalMessage = substituteVariables(messageTemplate, candidate);
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
                                        const varMatches = textInfo.match(/\{\{\d+\}\}/g) || [];
                                        const uniqueVars = [...new Set(varMatches)];
                                        if (uniqueVars.length > 0) {
                                            componentsToSend.push({
                                                type: cType,
                                                parameters: uniqueVars.map(() => ({ type: "text", text: candidateNameFallback }))
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
                            msgToSaveStr = `[Plantilla Masiva: ${templateName}] Hola ${candidateNameFallback}...`;
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

        // ─── CALCULAR PRÓXIMO DELAY ──────────────────────────────────────────

        // ¿Ya terminó?
        if (state.currentCandidateIndex >= state.candidates.length) {
            state.isRunning = false;
            state.nextSendAt = null;
            addLog(state, '✅ Envío masivo completado. Todos los contactos procesados.');
        }
        // ¿Toca descanso de seguridad?
        else if (state.totalSent > 0 && state.totalSent % (Number(state.pauseEvery) || 10) === 0) {
            const pauseMs = computePauseDelay(state);
            state.nextSendAt = Date.now() + pauseMs;
            const pauseMins = Math.round(pauseMs / 60000);
            addLog(state, `☕ Descanso de seguridad. Pausando ${pauseMins} minutos (hasta ${new Date(state.nextSendAt).toLocaleTimeString()})...`);
        }
        // Delay aleatorio normal
        else {
            const delayMs = computeNextDelay(state);
            state.nextSendAt = Date.now() + delayMs;
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

        const { candidates, messages, bulkType, templateData, minDelay, maxDelay, pauseEvery, pauseFor, campaignName } = req.body;

        if (!candidates?.length) {
            return res.status(400).json({ error: 'Faltan candidatos.' });
        }
        if (bulkType !== 'template' && !messages?.length) {
            return res.status(400).json({ error: 'Faltan mensajes para el envío libre.' });
        }
        if (bulkType === 'template' && !templateData?.name) {
            return res.status(400).json({ error: 'Falta configurar la plantilla a enviar.' });
        }

        const campaignId = campaignName ? `camp_${Date.now()}` : null;

        const newState = {
            isRunning: true,
            isAborted: false,
            bulkType: bulkType || 'text',
            templateData: templateData || null,
            candidates,
            messages: messages || [],
            minDelay: Number(minDelay) || 3,
            maxDelay: Number(maxDelay) || 7,
            pauseEvery: Number(pauseEvery) || 10,
            pauseFor: Number(pauseFor) || 10,
            currentCandidateIndex: 0,
            totalSent: 0,
            logs: [],
            campaignId,
            campaignName,
            startedAt: Date.now(),
            nextSendAt: Date.now() + 2000 // Primer envío en 2 segundos
        };

        addLog(newState, `🚀 Campaña iniciada para ${candidates.length} contactos con ${messages.length} variaciones.`);

        // Guardar campaña en historial
        if (campaignId) {
            try {
                const redis = getRedisClient();
                if (redis) {
                    const raw = await redis.get(REDIS_KEY_HISTORY);
                    let history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
                    history.unshift({
                        id: campaignId,
                        name: campaignName,
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
            state = await tickEngine(state);
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
