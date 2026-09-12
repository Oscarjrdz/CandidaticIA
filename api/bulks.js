import { getCandidateById, saveMessage, updateCandidate, updateMessageStatus } from './utils/storage.js';
import { substituteVariables } from './utils/shortcuts.js';
import { sendUltraMsgMessage, getUltraMsgConfig, buildMetaTemplateComponents, renderMetaTemplatePreviewText } from './whatsapp/utils.js';
import axios from 'axios';
import { getRedisClient, validateAdminSession } from './utils/storage.js';
import { getCachedConfig } from './utils/cache.js';
import { ensureFacetIndex, computeFacets, resolveSegmentIds, hydratePreview, countSegment } from './utils/facet-index.js';
import { NL_MUNICIPIOS } from './flows.js';

const PREVIEW_LIMIT = 100;
// Única fuente de verdad de los 51 municipios de NL (definida en api/flows.js).
const NL_MUNICIPIOS_SET = new Set(NL_MUNICIPIOS);

// Carga proyectos manuales + links para que el build del índice compartido pueda contar
// steps (mismo escaneo único que alimenta filter_counts). Fire-and-safe: si falla, {}.
const loadProjectData = async (redis) => {
    try {
        const projectsRaw = await redis.get('candidatic_manual_projects').catch(() => null);
        const projects = projectsRaw ? JSON.parse(projectsRaw) : [];
        const projectLinks = {};
        await Promise.all((Array.isArray(projects) ? projects : []).map(async project => {
            if (!project?.id) return;
            const linksRaw = await redis.get(`crm_links:${project.id}`).catch(() => null);
            try { projectLinks[project.id] = linksRaw ? JSON.parse(linksRaw) : []; } catch { projectLinks[project.id] = []; }
        }));
        return { manualProjects: Array.isArray(projects) ? projects : [], projectLinks };
    } catch { return {}; }
};

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
const REDIS_KEY_AUDIENCES = 'bulks:audiences'; // públicos guardados (audiencias dinámicas)

// ─── Públicos (audiencias dinámicas) ───────────────────────────────────────────
// Un público = un `selection` guardado con nombre. Es DINÁMICO: solo persiste los
// filtros; el conteo se recalcula en vivo con countSegment(). Los envíos hechos a un
// público quedan ligados vía `audienceId` en bulks:history (no hay estructura aparte).
const getAudiences = async (redis) => {
    try {
        const raw = await redis.get(REDIS_KEY_AUDIENCES);
        const arr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
};
const saveAudiences = (redis, list) => redis.set(REDIS_KEY_AUDIENCES, JSON.stringify(list));

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
        const BATCH_SIZE = 5;

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
                // Número emisor: el elegido en la campaña (fromNumberId) o, en Automático,
                // el número por el que llegó cada candidato.
                const senderId = state.fromNumberId || candidate.incomingPhoneNumberId || candidate.instanceId;
                const ultraConfig = await getUltraMsgConfig(senderId);

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
                                
                                const _nr = candidate.nombreReal?.trim().split(/\s+/)[0];
                                const candidateNameFallback = _nr || candidate.nombre?.trim().split(/\s+/)[0] || 'Candidato';
                                
                                extraParams = {
                                    templateName,
                                    languageCode
                                };
                                
                                // Construcción dinámica de componentes (DRY helper)
                                const componentsToSend = buildMetaTemplateComponents(
                                    state.templateData.components,
                                    candidateNameFallback,
                                    { templateParams: state.templateParams, parameterFormat: state.templateData.parameter_format }
                                );

                                if (componentsToSend.length > 0) {
                                    extraParams.components = componentsToSend;
                                }
                                
                                sendType = 'template';
                                const realText = renderMetaTemplatePreviewText(
                                    state.templateData,
                                    candidateNameFallback,
                                    { templateParams: state.templateParams }
                                );
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
                                const remoteId = sendResult.messageId || sendResult.data?.messages?.[0]?.id || sendResult.data?.id || sendResult.data?.messageId;
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

    // Seguridad: exige sesión admin válida (el dashboard ya adjunta el Bearer)
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const { action } = req.query;

    // ─── FACETS (motor de filtrado facetado) ───────────────────────────────────
    // Devuelve conteos drill-down por dimensión + total del segmento + vista previa.
    // El cruce de filtros se resuelve dentro de Redis (SINTERCARD) → solo enteros por la red.
    if (action === 'facets') {
        const redis = getRedisClient();
        if (!redis) return res.status(200).json({ success: true, total: 0, counts: {}, meta: { dims: {} }, preview: [] });
        try {
            const selection = (req.method === 'POST' ? req.body?.selection : null) || {};
            const meta = await ensureFacetIndex(redis, () => loadProjectData(redis));
            const { total, counts } = await computeFacets(redis, selection, meta);
            const previewIds = await resolveSegmentIds(redis, selection, [], PREVIEW_LIMIT);
            const preview = await hydratePreview(redis, previewIds);
            // El dropdown de municipio solo debe mostrar municipios de Nuevo León.
            const dims = { ...(meta.dims || {}) };
            if (Array.isArray(dims.municipio)) {
                dims.municipio = dims.municipio.filter(m => NL_MUNICIPIOS_SET.has(m));
            }
            return res.status(200).json({
                success: true,
                total,
                counts,
                meta: { dims, generatedAt: meta.generatedAt, total: meta.total },
                preview
            });
        } catch (e) {
            console.error('[BULK FACETS] error:', e?.message);
            return res.status(500).json({ success: false, error: 'Error calculando filtros' });
        }
    }

    // ─── PÚBLICOS: LISTAR (con conteo en vivo) ─────────────────────────────────
    if (req.method === 'GET' && action === 'audiences_list') {
        const redis = getRedisClient();
        if (!redis) return res.status(200).json({ success: true, audiences: [] });
        try {
            const audiences = await getAudiences(redis);
            // Conteo en vivo por público (dinámico). Es barato: solo enteros por SINTERCARD.
            const withCounts = await Promise.all(audiences.map(async (a) => {
                let count = 0;
                try { count = await countSegment(redis, a.selection || {}); } catch { count = 0; }
                const exCount = Array.isArray(a.excludeIds) ? a.excludeIds.length : 0;
                return { ...a, count: Math.max(0, count - exCount) };
            }));
            return res.status(200).json({ success: true, audiences: withCounts });
        } catch (e) {
            console.error('[AUDIENCES] list error:', e?.message);
            return res.status(500).json({ error: 'Error listando públicos' });
        }
    }

    // ─── PÚBLICOS: CREAR ───────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'audience_create') {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Sin conexión a Redis' });
        try {
            const { name, selection, excludeIds, criteriaSummary } = req.body || {};
            if (!name || !String(name).trim()) return res.status(400).json({ error: 'Falta el nombre del público' });
            const audiences = await getAudiences(redis);
            const audience = {
                id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: String(name).trim().slice(0, 80),
                selection: selection || {},
                excludeIds: Array.isArray(excludeIds) ? excludeIds : [],
                criteriaSummary: criteriaSummary || '',
                createdAt: new Date().toISOString(),
                lastCampaignAt: null,
                totalEverSent: 0
            };
            audiences.unshift(audience);
            await saveAudiences(redis, audiences);
            return res.status(200).json({ success: true, audience });
        } catch (e) {
            console.error('[AUDIENCES] create error:', e?.message);
            return res.status(500).json({ error: 'Error creando público' });
        }
    }

    // ─── PÚBLICOS: ACTUALIZAR (nombre / filtros) ───────────────────────────────
    if (req.method === 'POST' && action === 'audience_update') {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Sin conexión a Redis' });
        try {
            const { id, name, selection, excludeIds, criteriaSummary } = req.body || {};
            if (!id) return res.status(400).json({ error: 'Falta id del público' });
            const audiences = await getAudiences(redis);
            const idx = audiences.findIndex(a => a.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Público no encontrado' });
            if (name != null) audiences[idx].name = String(name).trim().slice(0, 80);
            if (selection !== undefined) audiences[idx].selection = selection || {};
            if (excludeIds !== undefined) audiences[idx].excludeIds = Array.isArray(excludeIds) ? excludeIds : [];
            if (criteriaSummary !== undefined) audiences[idx].criteriaSummary = criteriaSummary || '';
            audiences[idx].updatedAt = new Date().toISOString();
            await saveAudiences(redis, audiences);
            return res.status(200).json({ success: true, audience: audiences[idx] });
        } catch (e) {
            console.error('[AUDIENCES] update error:', e?.message);
            return res.status(500).json({ error: 'Error actualizando público' });
        }
    }

    // ─── PÚBLICOS: BORRAR ──────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'audience_delete') {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Sin conexión a Redis' });
        try {
            const { id } = req.body || {};
            if (!id) return res.status(400).json({ error: 'Falta id del público' });
            const audiences = await getAudiences(redis);
            await saveAudiences(redis, audiences.filter(a => a.id !== id));
            return res.status(200).json({ success: true });
        } catch (e) {
            console.error('[AUDIENCES] delete error:', e?.message);
            return res.status(500).json({ error: 'Error borrando público' });
        }
    }

    // ─── PÚBLICOS: HISTORIAL DE ENVÍOS (campañas ligadas a este público) ────────
    if (req.method === 'GET' && action === 'audience_history') {
        const redis = getRedisClient();
        if (!redis) return res.status(200).json({ success: true, history: [] });
        try {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Falta id del público' });
            const raw = await redis.get(REDIS_KEY_HISTORY);
            const history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
            return res.status(200).json({ success: true, history: history.filter(h => h.audienceId === id) });
        } catch (e) {
            console.error('[AUDIENCES] history error:', e?.message);
            return res.status(500).json({ error: 'Error obteniendo historial del público' });
        }
    }

    // ─── START ───────────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'start') {
        const existingState = await getState();
        if (existingState && existingState.isRunning) {
            return res.status(400).json({ error: 'Ya hay un envío en curso. Aborta primero.' });
        }

        const { candidates: candidatesInput, segment, messages, bulkType, templateData, templateParams, _minDelay, _maxDelay, _pauseEvery, _pauseFor, campaignName, fromNumberId, audienceId } = req.body;

        // El segmento (filtros facetados) se resuelve a la lista COMPLETA en el servidor,
        // así el navegador nunca sube miles de IDs. Alternativamente acepta IDs explícitos.
        // Si viene un audienceId (público guardado), sus filtros son la fuente de verdad
        // y se resuelven FRESCOS aquí (dinámico) — sin confiar en lo que mandó el cliente.
        let candidates = candidatesInput;
        let audience = null;
        let effectiveSegment = segment;
        if (audienceId) {
            const redis = getRedisClient();
            if (redis) {
                const audiences = await getAudiences(redis);
                audience = audiences.find(a => a.id === audienceId) || null;
            }
            if (!audience) return res.status(404).json({ error: 'Público no encontrado.' });
            effectiveSegment = { selection: audience.selection || {}, excludeIds: audience.excludeIds || [] };
            candidates = null; // forzar resolución fresca desde los filtros del público
        }
        if ((!candidates || !candidates.length) && effectiveSegment && effectiveSegment.selection) {
            const redis = getRedisClient();
            if (redis) {
                candidates = await resolveSegmentIds(redis, effectiveSegment.selection, effectiveSegment.excludeIds || [], 0);
            }
        }

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
            fromNumberId: fromNumberId || null, // número emisor elegido; null = Automático
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
            audienceId: audience?.id || null,
            audienceName: audience?.name || null,
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
                        status: 'running',
                        audienceId: audience?.id || null,
                        audienceName: audience?.name || null
                    });
                    await redis.set(REDIS_KEY_HISTORY, JSON.stringify(history));
                }
            } catch (e) { /* non-critical */ }
        }

        // Actualiza stats del público (última campaña + total histórico de destinatarios).
        if (audience) {
            try {
                const redis = getRedisClient();
                if (redis) {
                    const audiences = await getAudiences(redis);
                    const idx = audiences.findIndex(a => a.id === audience.id);
                    if (idx !== -1) {
                        audiences[idx].lastCampaignAt = new Date().toISOString();
                        audiences[idx].totalEverSent = (audiences[idx].totalEverSent || 0) + candidates.length;
                        await saveAudiences(redis, audiences);
                    }
                }
            } catch (e) { /* non-critical */ }
        }

        await saveState(newState);
        const payload = { success: true, message: 'Bulk started', state: newState };
        return res.status(200).json(payload);
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

        const payload = { success: true, state };
        return res.status(200).json(payload);
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
