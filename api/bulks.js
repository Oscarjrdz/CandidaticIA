import { getCandidateById, saveMessage, updateCandidate, updateMessageStatus, getCandidateByPhone } from './utils/storage.js';
import { substituteVariables } from './utils/shortcuts.js';
import { sendUltraMsgMessage, getUltraMsgConfig, buildMetaTemplateComponents, renderMetaTemplatePreviewText, resolveTemplateHeaderMedia } from './whatsapp/utils.js';
import axios from 'axios';
import { getRedisClient, validateAdminSession } from './utils/storage.js';
import { getCachedConfig } from './utils/cache.js';
import { ensureFacetIndex, computeFacets, resolveSegmentIds, hydratePreview, countSegment } from './utils/facet-index.js';
import { runInBackground } from './utils/background.js';
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
// Señal DURABLE de abort. Vive fuera del blob de estado para que un tick en vuelo
// (que tiene su propia copia de `state` en memoria) NO pueda revivir isRunning al
// guardar: el abort se escribe aquí y se lee FRESCO desde Redis. Ver tickEngine/abort.
const REDIS_KEY_ABORT = 'bulks:engine_aborted';
const BULK_LOCK = 'bulk_lock';               // serializa UN tick a la vez (cross-instancia)
const BULK_DRIVER_LOCK = 'bulk_driver_lock'; // garantiza UN solo driver server-side a la vez
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
    const ts = new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Monterrey' });
    state.logs.unshift(`[${ts}] ${msg}`);
    if (state.logs.length > 80) state.logs.length = 80; // cap
};

// Delays eliminados por blast logic

// ─── Core Tick Engine ────────────────────────────────────────────────────────

const isAbortSignaled = async () => {
    try {
        const redis = getRedisClient();
        if (!redis) return false;
        return !!(await redis.get(REDIS_KEY_ABORT));
    } catch { return false; }
};

const tickEngine = async (state) => {
    // Gate 1: no está corriendo
    if (!state || !state.isRunning) return state;

    // Gate 2: fue abortado (flag en el blob O señal durable fresca en Redis)
    if (state.isAborted || await isAbortSignaled()) {
        state.isRunning = false;
        state.isAborted = true;
        state.nextSendAt = null;
        state.finishedAt = state.finishedAt || Date.now();
        addLog(state, '🛑 Envío masivo ABORTADO por el usuario.');
        await saveState(state);
        await finalizeAudienceStats(state);
        return state;
    }

    // Gate 3: ya terminó todos los candidatos
    if (state.currentCandidateIndex >= state.candidates.length) {
        state.isRunning = false;
        state.finishedAt = state.finishedAt || Date.now();
        addLog(state, '✅ Envío masivo completado. Todos los contactos procesados.');
        await saveState(state);
        await finalizeAudienceStats(state);
        return state;
    }

    // Gate 4: lock — otro tick ya está procesando
    if (processingLock) return state;
    processingLock = true;

    try {
        let sentInTick = 0;
        // Ritmo adaptativo: plantillas con imagen/video/documento van LENTAS PERO SEGURAS
        // (lote chico + pausa larga) para no saturar a Meta ni arriesgar la entrega, y para
        // que cada tick termine muy por debajo del lock (30s) y del maxDuration (60s) —
        // así nunca hay ticks concurrentes ni cortes a media que causen duplicados.
        // Texto va rápido (lote grande, pausa mínima).
        const isMediaCampaign = state.bulkType === 'template' && (state.templateData?.components || [])
            .some(c => (c.type || '').toUpperCase() === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes((c.format || '').toUpperCase()));
        const BATCH_SIZE = isMediaCampaign ? 3 : 5;
        const perMsgDelay = isMediaCampaign ? 3000 : 50;

        while (sentInTick < BATCH_SIZE && state.currentCandidateIndex < state.candidates.length && state.isRunning && !state.isAborted) {
            // Abort a media ráfaga: relee la señal durable fresca antes de cada envío.
            if (await isAbortSignaled()) {
                state.isAborted = true;
                state.isRunning = false;
                break;
            }
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
                                
                                // Nombre simple del candidato: primero nombreReal, luego nombre,
                                // y si nada está disponible — 'Candidato'. Blindado contra null/undefined.
                                const _nr = (candidate.nombreReal || '').trim().split(/\s+/)[0];
                                const _n = (candidate.nombre || '').trim().split(/\s+/)[0];
                                const candidateNameFallback = _nr || _n || 'Candidato';
                                
                                extraParams = {
                                    templateName,
                                    languageCode
                                };
                                
                                // Header multimedia: media id entregable (subido/cacheado por
                                // número emisor). El link de header_handle NO entrega.
                                const headerMediaId = await resolveTemplateHeaderMedia(state.templateData, {
                                    phoneNumberId: ultraConfig.instanceId,
                                    accessToken: ultraConfig.token,
                                    redis: getRedisClient()
                                });

                                // Construcción dinámica de componentes (DRY helper)
                                const componentsToSend = buildMetaTemplateComponents(
                                    state.templateData.components,
                                    candidateNameFallback,
                                    { templateParams: state.templateParams, mediaId: headerMediaId, parameterFormat: state.templateData.parameter_format }
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
                                // 💬 Ventana de atribución de RESPUESTA: si este candidato contesta
                                // (aunque sea días después, retroactivo), su PRIMERA respuesta cuenta
                                // como "respondido" de esta campaña. TTL 90d. El webhook hace GETDEL.
                                if (state.campaignId) {
                                    getRedisClient()?.set(`campaign:reply_await:${candidateId}`, state.campaignId, 'EX', 60 * 60 * 24 * 90).catch(() => {});
                                }
                                // 🏷️ Etiqueta Broadcast (INDEPENDIENTE de tags de Chat Web / anuncios):
                                // side-keys permanentes, sin TTL, sin tocar el blob del candidato.
                                //   broadcast:tag:<etiqueta>   → set de candidatos que recibieron el broadcast
                                //   broadcast:candidate:<id>    → set de broadcasts que recibió el candidato
                                if (state.broadcastTag) {
                                    const bc = getRedisClient();
                                    if (bc) {
                                        const p = bc.pipeline();
                                        p.sadd(`broadcast:tag:${state.broadcastTag}`, candidateId);
                                        p.sadd(`broadcast:candidate:${candidateId}`, state.broadcastTag);
                                        // Marca de PRIMERA respuesta pendiente para el disparador de flujos
                                        // "al responder broadcast". El motor la consume (GET+DEL) en la
                                        // primera respuesta del candidato. Ventana de atribución = 72h:
                                        // si contesta después, ya no cuenta como "respuesta al broadcast".
                                        p.set(`broadcast:reply_pending:${candidateId}`, state.broadcastTag, 'EX', 60 * 60 * 72);
                                        p.exec().catch(() => {});
                                    }
                                }
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

            // Pausa entre envíos según el ritmo adaptativo (media = lento y seguro; ver arriba).
            await new Promise(r => setTimeout(r, perMsgDelay));
        }

        // Red de seguridad: si se abortó (señal durable) mientras corría el lote, NO revivir
        // isRunning al guardar. Esta es la causa del bug "aborté y siguió enviando": el tick
        // en vuelo pisaba el abort con su copia en memoria.
        if (state.isAborted || await isAbortSignaled()) {
            state.isRunning = false;
            state.isAborted = true;
            state.nextSendAt = null;
            state.finishedAt = Date.now();
            addLog(state, '🛑 Envío masivo ABORTADO por el usuario.');
        } else if (state.currentCandidateIndex >= state.candidates.length) {
            // ¿Ya terminó todo el lote/campaña?
            state.isRunning = false;
            state.nextSendAt = null;
            state.finishedAt = Date.now();
            addLog(state, '✅ Envío masivo completado. Todos los contactos procesados.');
        } else {
            // Continúa instantáneamente en el siguiente tick
            state.nextSendAt = Date.now();
        }

        await saveState(state);
        // Si la campaña terminó (completada o abortada), suma lo realmente enviado al público.
        if (!state.isRunning) await finalizeAudienceStats(state);

    } finally {
        processingLock = false;
    }

    return state;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Suma lo REALMENTE enviado al histórico del público, UNA sola vez por campaña
// (marcador NX cross-instancia). Antes se sumaba el total de destinatarios al iniciar,
// lo que inflaba "enviados" si la campaña se abortaba a medias.
const finalizeAudienceStats = async (state) => {
    if (!state?.audienceId || !state?.campaignId) return;
    const redis = getRedisClient();
    if (!redis) return;
    try {
        const once = await redis.set(`bulks:stats_final:${state.campaignId}`, '1', 'EX', 60 * 60 * 24 * 7, 'NX');
        if (!once) return; // ya se contabilizó esta campaña
        const auds = await getAudiences(redis);
        const idx = auds.findIndex(a => a.id === state.audienceId);
        if (idx !== -1) {
            auds[idx].totalEverSent = (auds[idx].totalEverSent || 0) + (state.totalSent || 0);
            await saveAudiences(redis, auds);
        }
    } catch (e) { /* non-critical */ }
};

// Ejecuta UN tick de forma segura entre instancias: toma bulk_lock y RELEE el estado
// FRESCO dentro del lock antes de procesar. Esto evita duplicados cuando hay dos
// empujadores a la vez (driver del servidor + poll del frontend): sin el relee, un
// tick podría correr con un índice rancio y reenviar candidatos ya enviados.
// Devuelve el estado tras el tick, o null si otro tick tenía el lock.
const tickOnceLocked = async () => {
    const redis = getRedisClient();
    if (!redis) { // sin redis no hay lock posible; degradar (entorno no-prod)
        const s = await getState();
        return s ? await tickEngine(s) : null;
    }
    const lock = await redis.set(BULK_LOCK, '1', 'EX', 30, 'NX');
    if (!lock) return null; // otro tick en curso
    try {
        const fresh = await getState();
        if (!fresh) return null;
        return await tickEngine(fresh);
    } finally {
        await redis.del(BULK_LOCK).catch(() => {});
    }
};

// Driver server-side: empuja el motor sin depender del navegador. Drena lotes hasta
// ~50s (bajo maxDuration 60s); si la campaña sigue viva, ENCADENA otra invocación vía
// auto-fetch autenticado con CRON_SECRET. Un solo driver a la vez (BULK_DRIVER_LOCK).
const driveLoop = async (driveUrl) => {
    const redis = getRedisClient();
    const t0 = Date.now();
    try {
        while (Date.now() - t0 < 50_000) {
            const state = await getState();
            if (!state || !state.isRunning || state.isAborted) break;
            if (await isAbortSignaled()) break;
            if (state.currentCandidateIndex >= (state.candidates?.length || 0)) break;
            const ticked = await tickOnceLocked();
            if (ticked === null) await sleep(400); // otro tick tenía el lock; reintenta
            if (redis) await redis.pexpire(BULK_DRIVER_LOCK, 65_000).catch(() => {});
        }
    } catch (e) {
        console.error('[BULK DRIVER] loop error:', e?.message);
    }
    // ¿Sigue viva? Encadena la siguiente invocación. Si terminó/abortó, suelta el lock.
    const fin = await getState();
    const alive = fin && fin.isRunning && !fin.isAborted
        && fin.currentCandidateIndex < (fin.candidates?.length || 0)
        && !(await isAbortSignaled());
    if (redis) await redis.del(BULK_DRIVER_LOCK).catch(() => {});
    if (alive && driveUrl && process.env.CRON_SECRET) {
        await fetch(driveUrl, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {});
    }
};

// URL absoluta a este mismo endpoint (para auto-invocación). Patrón de api/config.js.
const buildDriveUrl = (req) => {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return host ? `${proto}://${host}/api/bulks?action=drive` : null;
};


// ═══════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.query;

    // Auto-invocación interna del driver server-side: autenticada con CRON_SECRET,
    // SOLO para la acción 'drive' (empuja el motor sin navegador). Ver driveLoop().
    const isInternalDrive = action === 'drive'
        && !!process.env.CRON_SECRET
        && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

    // Seguridad: exige sesión admin válida (el dashboard ya adjunta el Bearer)
    if (!isInternalDrive) {
        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });
    }

    // ─── DRIVE (interno): arranca/continúa el driver server-side ────────────────
    if (action === 'drive') {
        const redis = getRedisClient();
        if (!redis) return res.status(200).json({ success: true, driving: false });
        // Un solo driver a la vez. Si ya hay uno vivo, no arrancar otro.
        const got = await redis.set(BULK_DRIVER_LOCK, '1', 'EX', 65, 'NX');
        if (!got) return res.status(200).json({ success: true, driving: true, note: 'ya hay un driver activo' });
        runInBackground(driveLoop(buildDriveUrl(req)));
        return res.status(200).json({ success: true, driving: true });
    }

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

    // ─── BÚSQUEDA POR TELÉFONO (envío directo, en toda la base) ────────────────
    // Localiza UN candidato por teléfono para el flujo "enviar directo a este número"
    // sin crear público. Tolera variantes MX (10 dígitos, 52+, 521+).
    if (action === 'phone_lookup') {
        try {
            const phone = (req.method === 'POST' ? req.body?.phone : req.query?.phone) || '';
            const digits = String(phone).replace(/\D/g, '');
            if (digits.length < 10) return res.status(200).json({ success: true, candidate: null });
            const c = await getCandidateByPhone(digits);
            if (!c) return res.status(200).json({ success: true, candidate: null });
            // Solo los campos que la UI necesita (chip + variables del envío).
            return res.status(200).json({
                success: true,
                candidate: {
                    id: c.id,
                    whatsapp: c.whatsapp || c.telefono || digits,
                    nombre: c.nombre || null,
                    nombreReal: c.nombreReal || null,
                    municipio: c.municipio || null,
                    edad: c.edad || null
                }
            });
        } catch (e) {
            console.error('[BULKS] phone_lookup error:', e?.message);
            return res.status(500).json({ error: 'Error buscando el teléfono' });
        }
    }

    // ─── PÚBLICOS: LISTAR (con conteo en vivo) ─────────────────────────────────
    if (req.method === 'GET' && action === 'audiences_list') {
        const redis = getRedisClient();
        if (!redis) return res.status(200).json({ success: true, audiences: [] });
        try {
            const audiences = await getAudiences(redis);
            // Conteo en vivo por público (dinámico). Es barato: solo enteros por SINTERCARD.
            // Público ESTÁTICO (includeIds): lista fija de personas → el conteo es su tamaño,
            // no se recalcula con filtros.
            const withCounts = await Promise.all(audiences.map(async (a) => {
                if (Array.isArray(a.includeIds) && a.includeIds.length) {
                    return { ...a, count: a.includeIds.length };
                }
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
            const { name, selection, excludeIds, includeIds, criteriaSummary, broadcastTag } = req.body || {};
            if (!name || !String(name).trim()) return res.status(400).json({ error: 'Falta el nombre del público' });
            const audiences = await getAudiences(redis);
            const cleanBroadcastTag = (typeof broadcastTag === 'string' ? broadcastTag : '').trim().slice(0, 60) || null;
            // Público ESTÁTICO: lista fija de IDs elegidos a mano (no cambia con filtros).
            const cleanIncludeIds = Array.isArray(includeIds) ? includeIds.slice(0, 20000) : [];
            const audience = {
                id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: String(name).trim().slice(0, 80),
                selection: cleanIncludeIds.length ? {} : (selection || {}),
                excludeIds: cleanIncludeIds.length ? [] : (Array.isArray(excludeIds) ? excludeIds : []),
                includeIds: cleanIncludeIds,
                criteriaSummary: criteriaSummary || '',
                broadcastTag: cleanBroadcastTag,
                createdAt: new Date().toISOString(),
                lastCampaignAt: null,
                totalEverSent: 0
            };
            audiences.unshift(audience);
            await saveAudiences(redis, audiences);
            // Registro global de etiquetas Broadcast (para reusarlas). Ver módulo etiqueta-broadcast.
            if (cleanBroadcastTag) redis.sadd('broadcast:tags:all', cleanBroadcastTag).catch(() => {});
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
            const { id, name, selection, excludeIds, includeIds, criteriaSummary, broadcastTag } = req.body || {};
            if (!id) return res.status(400).json({ error: 'Falta id del público' });
            const audiences = await getAudiences(redis);
            const idx = audiences.findIndex(a => a.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Público no encontrado' });
            if (name != null) audiences[idx].name = String(name).trim().slice(0, 80);
            // Lista estática (includeIds) y filtros dinámicos (selection/excludeIds) son excluyentes.
            if (includeIds !== undefined) {
                const cleanIncludeIds = Array.isArray(includeIds) ? includeIds.slice(0, 20000) : [];
                audiences[idx].includeIds = cleanIncludeIds;
                if (cleanIncludeIds.length) { audiences[idx].selection = {}; audiences[idx].excludeIds = []; }
            }
            const isStatic = Array.isArray(audiences[idx].includeIds) && audiences[idx].includeIds.length;
            if (selection !== undefined && !isStatic) audiences[idx].selection = selection || {};
            if (excludeIds !== undefined && !isStatic) audiences[idx].excludeIds = Array.isArray(excludeIds) ? excludeIds : [];
            if (criteriaSummary !== undefined) audiences[idx].criteriaSummary = criteriaSummary || '';
            if (broadcastTag !== undefined) {
                const cleanBroadcastTag = (typeof broadcastTag === 'string' ? broadcastTag : '').trim().slice(0, 60) || null;
                audiences[idx].broadcastTag = cleanBroadcastTag;
                if (cleanBroadcastTag) redis.sadd('broadcast:tags:all', cleanBroadcastTag).catch(() => {});
            }
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

        const { candidates: candidatesInput, segment, messages, bulkType, templateData, templateParams, _minDelay, _maxDelay, _pauseEvery, _pauseFor, campaignName, fromNumberId, audienceId, broadcastTag: broadcastTagInput } = req.body;

        // 🏷️ Etiqueta Broadcast: espacio INDEPENDIENTE de las etiquetas del Chat Web y de
        // las de anuncios. No se guarda en el blob del candidato — vive solo en side-keys
        // (broadcast:tag:*, broadcast:candidate:*) sin TTL. Ver tagBroadcast() en el loop.
        const broadcastTag = (typeof broadcastTagInput === 'string' ? broadcastTagInput : '').trim().slice(0, 60) || null;

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
            if (Array.isArray(audience.includeIds) && audience.includeIds.length) {
                // Público ESTÁTICO: lista fija de personas elegidas a mano.
                candidates = audience.includeIds;
                effectiveSegment = null;
            } else {
                effectiveSegment = { selection: audience.selection || {}, excludeIds: audience.excludeIds || [] };
                candidates = null; // forzar resolución fresca desde los filtros del público
            }
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
        if (!campaignName || !String(campaignName).trim()) {
            return res.status(400).json({ error: 'Ponle un nombre a la campaña antes de enviar.' });
        }

        const campaignId = `camp_${Date.now()}`;
        const displayName = String(campaignName).trim().slice(0, 120);

        // Limpiar cualquier señal de abort previa para que la nueva campaña no nazca abortada.
        { const redis = getRedisClient(); if (redis) await redis.del(REDIS_KEY_ABORT).catch(() => {}); }

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
            // Etiqueta escrita en el envío gana; si no hay, se hereda la del público seleccionado.
            broadcastTag: broadcastTag || audience?.broadcastTag || null,
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
                        broadcastTag: newState.broadcastTag,
                        audienceId: audience?.id || null,
                        audienceName: audience?.name || null
                    });
                    await redis.set(REDIS_KEY_HISTORY, JSON.stringify(history));
                    // Registro global de etiquetas Broadcast (para reusarlas al crear campañas).
                    // Independiente del sistema de etiquetas del Chat Web / anuncios. Sin TTL.
                    if (newState.broadcastTag) redis.sadd('broadcast:tags:all', newState.broadcastTag).catch(() => {});
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
                        // OJO: totalEverSent NO se incrementa aquí. Antes sumaba candidates.length
                        // (los destinatarios al iniciar), inflando el conteo si la campaña se
                        // abortaba a medias. Ahora se suma lo REALMENTE enviado al finalizar
                        // (finalizeAudienceStats, en las ramas de completado/abort de tickEngine).
                        await saveAudiences(redis, audiences);
                    }
                }
            } catch (e) { /* non-critical */ }
        }

        await saveState(newState);

        // 🚀 Arranca el driver server-side: empuja el motor aunque el usuario salga de la
        // sección o cierre el navegador. Si no hay driver vivo, el 'drive' arranca uno;
        // si ya hay (caso raro), no-op. Fire-and-forget con waitUntil para no congelarse.
        const driveUrl = buildDriveUrl(req);
        if (driveUrl && process.env.CRON_SECRET) {
            runInBackground(
                fetch(driveUrl, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
            );
        }

        const payload = { success: true, message: 'Bulk started', state: newState };
        return res.status(200).json(payload);
    }

    // ─── ABORT ───────────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'abort') {
        // Señal DURABLE primero: aunque un tick esté en vuelo con su copia en memoria,
        // la leerá fresca y no podrá revivir isRunning al guardar. (Antes: el tick pisaba
        // el abort y la campaña seguía enviando tras recargar.)
        const redis = getRedisClient();
        if (redis) await redis.set(REDIS_KEY_ABORT, '1', 'EX', 60 * 60).catch(() => {});

        const state = await getState();
        if (!state) {
            return res.status(200).json({ success: true, message: 'No hay campaña activa.' });
        }

        state.isRunning = false;
        state.isAborted = true;
        state.nextSendAt = null;
        state.finishedAt = state.finishedAt || Date.now();
        addLog(state, '🛑 Envío masivo ABORTADO por el usuario.');
        await saveState(state);
        // Respaldo: si se abortó estando inactivo (sin tick en vuelo que finalice),
        // contabiliza aquí lo enviado. El marcador NX evita doble conteo con el tick.
        await finalizeAudienceStats(state);

        return res.status(200).json({ success: true, message: 'Bulk aborted' });
    }

    // ─── STATUS LIGHT (resumen chico para el header global) ────────────────────
    // Solo-lectura: NO hace tick ni devuelve los arrays pesados (candidates/messages/logs).
    // Pensado para que el header del dashboard muestre el avance sin costar ancho de banda.
    if (req.method === 'GET' && action === 'status_light') {
        const state = await getState();
        if (!state) return res.status(200).json({ success: true, running: false });
        return res.status(200).json({
            success: true,
            running: !!state.isRunning,
            aborted: !!state.isAborted,
            campaignName: state.campaignName || null,
            index: Math.min(state.currentCandidateIndex || 0, state.candidates?.length || 0),
            total: state.candidates?.length || 0,
            totalSent: state.totalSent || 0,
            startedAt: state.startedAt || null,
            finishedAt: state.finishedAt || null
        });
    }

    // ─── CLEAR ───────────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'clear') {
        const redis = getRedisClient();
        if (redis) {
            await redis.del(REDIS_KEY_STATE);
            await redis.del(REDIS_KEY_ABORT).catch(() => {}); // limpiar señal para la próxima campaña
            await redis.del(BULK_DRIVER_LOCK).catch(() => {}); // soltar driver para la próxima campaña
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

        // Señal durable de abort: si está puesta, NO avanzar y forzar isRunning=false
        // (aunque un tick previo haya revivido isRunning al guardar).
        if (state.isRunning && await isAbortSignaled()) {
            state.isRunning = false;
            state.isAborted = true;
            state.nextSendAt = null;
            state.finishedAt = state.finishedAt || Date.now();
            await saveState(state);
        }

        // 🔥 TICK (respaldo): el motor lo empuja el driver server-side, pero el poll del
        // frontend también avanza — con RELEE fresco dentro del lock (tickOnceLocked) para
        // no duplicar. Si no hay driver vivo, lo re-lanza (robustez si se cayó el encadenado).
        if (state.isRunning && !state.isAborted) {
            const redis = getRedisClient();
            // Re-lanzar driver si corre y no hay uno activo (p. ej. se cayó el chain sin navegador).
            if (redis) {
                const got = await redis.set(BULK_DRIVER_LOCK, '1', 'EX', 65, 'NX').catch(() => null);
                if (got) runInBackground(driveLoop(buildDriveUrl(req)));
            }
            const ticked = await tickOnceLocked();
            if (ticked) state = ticked;
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

    // ─── BROADCAST TAGS (registro para reusar al crear campañas) ───────────────
    if (req.method === 'GET' && action === 'broadcast_tags') {
        try {
            const redis = getRedisClient();
            if (redis) {
                const tags = await redis.smembers('broadcast:tags:all');
                return res.status(200).json({ success: true, tags: (tags || []).sort((a, b) => a.localeCompare(b, 'es')) });
            }
        } catch (e) {
            return res.status(500).json({ error: 'Failed getting broadcast tags' });
        }
        return res.status(200).json({ success: true, tags: [] });
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
                // Limpiar también las estadísticas de la campaña (no dejar hash huérfano).
                redis.del(`bulk_stats:${id}`).catch(() => {});
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
