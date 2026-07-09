/**
 * Endpoint para gestionar candidatos
 * GET /api/candidates?limit=50&offset=0&search=
 * GET /api/candidates/:id
 * DELETE /api/candidates/:id
 */

// NO TOP LEVEL IMPORTS to prevent boot crashes
const CANDIDATES_LIST_CACHE_TTL_MS = 15000;
const FILTER_COUNTS_CACHE_TTL_SECONDS = 15 * 60;
const FILTER_COUNTS_STALE_TTL_SECONDS = 24 * 60 * 60;
const FILTER_COUNTS_CACHE_KEY = 'cache:candidates:filter_counts:v1';
const FILTER_COUNTS_STALE_KEY = 'cache:candidates:filter_counts:v1:stale';
const FILTER_COUNTS_LOCK_KEY = 'cache:candidates:filter_counts:v1:lock';
const candidatesListCache = new Map();
const MANUAL_PROJECTS_KEY = 'candidatic_manual_projects';
const MANUAL_PROJECT_LINKS_PREFIX = 'crm_links:';

function getCachedCandidatesList(key) {
    const item = candidatesListCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
        candidatesListCache.delete(key);
        return null;
    }
    return item.payload;
}

function setCachedCandidatesList(key, payload) {
    if (candidatesListCache.size > 200) {
        const firstKey = candidatesListCache.keys().next().value;
        if (firstKey) candidatesListCache.delete(firstKey);
    }
    candidatesListCache.set(key, {
        expiresAt: Date.now() + CANDIDATES_LIST_CACHE_TTL_MS,
        payload
    });
}

function clearCandidatesListCache() {
    candidatesListCache.clear();
}

function clearFilterCountsCache(redis) {
    if (!redis) return;
    redis.del(FILTER_COUNTS_CACHE_KEY).catch(() => {});
}

function incrementCount(map, rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return;
    map[value] = (map[value] || 0) + 1;
}

async function buildFilterCounts(redis) {
    const cached = await redis.get(FILTER_COUNTS_CACHE_KEY);
    if (cached) return JSON.parse(cached);

    const lockValue = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const lockAcquired = await redis.set(FILTER_COUNTS_LOCK_KEY, lockValue, 'EX', 45, 'NX').catch(() => null);

    if (lockAcquired !== 'OK') {
        const stale = await redis.get(FILTER_COUNTS_STALE_KEY).catch(() => null);
        if (stale) return JSON.parse(stale);

        for (let i = 0; i < 6; i++) {
            await new Promise(resolve => setTimeout(resolve, 200));
            const fresh = await redis.get(FILTER_COUNTS_CACHE_KEY).catch(() => null);
            if (fresh) return JSON.parse(fresh);
        }
    } else {
        const fresh = await redis.get(FILTER_COUNTS_CACHE_KEY).catch(() => null);
        if (fresh) {
            await redis.del(FILTER_COUNTS_LOCK_KEY).catch(() => {});
            return JSON.parse(fresh);
        }
    }

    // Monitor: registra que corrio un scan completo de candidatos (dato para el medidor)
    import('./utils/redis-bandwidth.js').then(m => m.recordScanEvent(redis, 'filter_counts')).catch(() => {});

    const ids = await redis.zrevrange('candidates:list', 0, -1);
    const existingCandidateIds = new Set();
    const counts = {
        ages: {},
        genders: {},
        municipalities: {},
        projects: {},
        stepsByProject: {}
    };

    const CHUNK_SIZE = 500;
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const pipe = redis.pipeline();
        chunk.forEach(id => pipe.get(`candidate:${id}`));
        const rows = await pipe.exec();

        rows.forEach(([err, raw]) => {
            if (err || !raw) return;
            try {
                const c = JSON.parse(raw);
                if (c?.id) existingCandidateIds.add(String(c.id));
                incrementCount(counts.ages, c.edad);
                incrementCount(counts.genders, c.genero);
                incrementCount(counts.municipalities, c.municipio);
                incrementCount(counts.projects, c.manualProjectId);
            } catch {
                // Ignore malformed candidate payloads while building aggregate filters.
            }
        });
    }

    const projectsRaw = await redis.get(MANUAL_PROJECTS_KEY).catch(() => null);
    const projects = projectsRaw ? JSON.parse(projectsRaw) : [];
    await Promise.all((Array.isArray(projects) ? projects : []).map(async project => {
        if (!project?.id) return;
        const validStepIds = new Set((project.steps || []).map(step => String(step.id || '').trim()).filter(Boolean));
        const linksRaw = await redis.get(`${MANUAL_PROJECT_LINKS_PREFIX}${project.id}`).catch(() => null);
        let links = [];
        try { links = linksRaw ? JSON.parse(linksRaw) : []; } catch { links = []; }
        links.forEach(link => {
            const candidateId = String(link?.candidateId || '').trim();
            const stepId = String(link?.stepId || '').trim();
            if (!candidateId || !existingCandidateIds.has(candidateId)) return;
            if (validStepIds.size > 0 && (!stepId || !validStepIds.has(stepId))) return;
            if (stepId) {
                if (!counts.stepsByProject[project.id]) counts.stepsByProject[project.id] = {};
                incrementCount(counts.stepsByProject[project.id], stepId);
            }
        });
    }));

    const payload = { ...counts, total: ids.length, generatedAt: new Date().toISOString() };
    const payloadRaw = JSON.stringify(payload);
    const pipe = redis.pipeline();
    pipe.set(FILTER_COUNTS_CACHE_KEY, payloadRaw, 'EX', FILTER_COUNTS_CACHE_TTL_SECONDS);
    pipe.set(FILTER_COUNTS_STALE_KEY, payloadRaw, 'EX', FILTER_COUNTS_STALE_TTL_SECONDS);
    if (lockAcquired === 'OK') pipe.del(FILTER_COUNTS_LOCK_KEY);
    await pipe.exec().catch(() => {});
    return payload;
}

// Campos de anuncio (Meta Ads) que solo usa AdsStatisticsSection.jsx (via
// /api/ads-stats, no via este endpoint) o el backend directo (webhook/conversions).
// Confirmado con grep que ninguna vista de lista/chat los lee. En candidatos con
// origen de anuncio pueden pesar mas de la mitad del registro completo (adBody
// guarda el texto crudo del anuncio) — quitarlos aqui no afecta ninguna UI.
const LIST_HEAVY_AD_FIELDS = ['adBody', 'adImageUrl', 'adUrl', 'adClickId'];

function stripHeavyListFields(candidate) {
    if (!candidate || typeof candidate !== 'object') return candidate;
    const trimmed = { ...candidate };
    for (const field of LIST_HEAVY_AD_FIELDS) delete trimmed[field];
    return trimmed;
}

function buildCandidatesListPayload({ candidates = [], total = 0, limit = 100, offset = 0, statsData = null }) {
    const safeLimit = Math.max(1, parseInt(limit, 10) || 100);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCandidates = Array.isArray(candidates) ? candidates.map(stripHeavyListFields) : candidates;
    const count = Array.isArray(safeCandidates) ? safeCandidates.length : 0;
    const nextOffset = safeOffset + count;

    return {
        success: true,
        count,
        total: safeTotal,
        candidates: safeCandidates,
        hasMore: count > 0 && nextOffset < safeTotal,
        pagination: {
            limit: safeLimit,
            offset: safeOffset,
            nextOffset,
            hasMore: count > 0 && nextOffset < safeTotal,
            total: safeTotal
        },
        stats: statsData
    };
}

export default async function handler(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // DYNAMIC IMPORTS
        const { getCandidates, getCandidatesUnreadFirst, getCandidatesUnreadFirstByTag, getCandidatesFiltered, getCandidateById, deleteCandidate, validateAdminSession, getRedisClient } = await import('./utils/storage.js');
        const redisForMetrics = getRedisClient();
        const finishCandidatesResponse = async (status, payload) => {
            return res.status(status).json(payload);
        };

        // Validar sesión admin
        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        // GET /api/candidates - Obtener lista o estadísticas
        if (req.method === 'GET') {
            const { limit = '100', offset = '0', search = '', stats, id, excludeLinked = 'false', tag = '', unreadFirst = 'false', filter = '', action = '', manualProjectId = '', manualStepId = '' } = req.query;

            if (action === 'filter_counts') {
                const counts = await buildFilterCounts(redisForMetrics);
                return finishCandidatesResponse(200, { success: true, counts });
            }

            // Estadísticas (Optional mixed response)
            let statsData = null;
            if (stats === 'true') {
                const redis = redisForMetrics;

                const pipeline = redis.pipeline();
                pipeline.get('stats:msg:incoming');
                pipeline.get('stats:msg:outgoing');
                pipeline.scard('stats:list:complete');
                pipeline.scard('stats:list:pending');
                const results = await pipeline.exec();

                const incoming = results[0][1] || '0';
                const outgoing = results[1][1] || '0';
                const completeCount = results[2][1] || 0;
                const pendingCount = results[3][1] || 0;

                statsData = {
                    candidates: completeCount + pendingCount,
                    incoming: parseInt(incoming),
                    outgoing: parseInt(outgoing),
                    complete: completeCount,
                    pending: pendingCount
                };
            }

            // Candidato específico por ID
            if (id) {
                const candidate = await getCandidateById(id);
                if (!candidate) {
                    return res.status(404).json({
                        success: false,
                        error: 'Candidato no encontrado'
                    });
                }
                return finishCandidatesResponse(200, {
                    success: true,
                    candidate: candidate
                });
            }

            const cacheKey = JSON.stringify({
                userId,
                limit: String(limit),
                offset: String(offset),
                search: String(search || ''),
                stats: String(stats || ''),
                excludeLinked: String(excludeLinked || ''),
                tag: String(tag || ''),
                unreadFirst: String(unreadFirst || ''),
                filter: String(filter || ''),
                manualProjectId: String(manualProjectId || ''),
                manualStepId: String(manualStepId || '')
            });
            const cachedPayload = getCachedCandidatesList(cacheKey);
            if (cachedPayload) {
                res.setHeader('X-Candidatic-Cache', 'HIT');
                res.setHeader('Cache-Control', 'private, max-age=10');
                return finishCandidatesResponse(200, cachedPayload);
            }

            // Modo filtro servidor: unread / complete / incomplete (sin tag ni búsqueda)
            if (manualProjectId) {
                const safeLimit = parseInt(limit, 10) || 500;
                const safeOffset = parseInt(offset, 10) || 0;
                const { candidates, total } = await getCandidates(
                    safeLimit,
                    safeOffset,
                    search,
                    excludeLinked === 'true',
                    tag,
                    manualProjectId,
                    manualStepId,
                    filter
                );
                const payload = buildCandidatesListPayload({ candidates, total, limit: safeLimit, offset: safeOffset, statsData });
                setCachedCandidatesList(cacheKey, payload);
                res.setHeader('X-Candidatic-Cache', 'MISS');
                res.setHeader('Cache-Control', 'private, max-age=10');
                return finishCandidatesResponse(200, payload);
            }

            if (['unread', 'complete', 'incomplete'].includes(filter) && !search && !tag) {
                const safeLimit = parseInt(limit, 10) || 500;
                const safeOffset = parseInt(offset, 10) || 0;
                const { candidates, total } = await getCandidatesFiltered(filter, safeLimit, safeOffset);
                const payload = buildCandidatesListPayload({ candidates, total, limit: safeLimit, offset: safeOffset });
                setCachedCandidatesList(cacheKey, payload);
                res.setHeader('X-Candidatic-Cache', 'MISS');
                res.setHeader('Cache-Control', 'private, max-age=10');
                return finishCandidatesResponse(200, payload);
            }

            // Modo unreadFirst sin filtro: no-leídos + N recientes
            if (unreadFirst === 'true' && !search && !tag && excludeLinked !== 'true') {
                const safeLimit = parseInt(limit, 10) || 50;
                const safeOffset = parseInt(offset, 10) || 0;
                const { candidates, total } = await getCandidatesUnreadFirst(safeLimit, safeOffset);
                const payload = buildCandidatesListPayload({
                    candidates,
                    total: statsData?.candidates || total,
                    limit: safeLimit,
                    offset: safeOffset,
                    statsData
                });
                setCachedCandidatesList(cacheKey, payload);
                res.setHeader('X-Candidatic-Cache', 'MISS');
                res.setHeader('Cache-Control', 'private, max-age=10');
                return finishCandidatesResponse(200, payload);
            }

            // Modo unreadFirst con tag activo y primera página: no-leídos con ese tag primero
            if (unreadFirst === 'true' && tag && !search && excludeLinked !== 'true') {
                const safeLimit = parseInt(limit, 10) || 33;
                const safeOffset = parseInt(offset, 10) || 0;
                const { candidates, total } = await getCandidatesUnreadFirstByTag(tag, safeLimit, safeOffset);
                const payload = buildCandidatesListPayload({ candidates, total, limit: safeLimit, offset: safeOffset });
                setCachedCandidatesList(cacheKey, payload);
                res.setHeader('X-Candidatic-Cache', 'MISS');
                res.setHeader('Cache-Control', 'private, max-age=10');
                return finishCandidatesResponse(200, payload);
            }

            // Lista de candidatos (modo normal)
            const safeLimit = parseInt(limit, 10) || 100;
            const safeOffset = parseInt(offset, 10) || 0;
            const { candidates, total } = await getCandidates(
                safeLimit,
                safeOffset,
                search,
                excludeLinked === 'true',
                tag
            );

            const payload = buildCandidatesListPayload({
                candidates,
                total: statsData?.candidates || total,
                limit: safeLimit,
                offset: safeOffset,
                statsData
            });
            setCachedCandidatesList(cacheKey, payload);
            res.setHeader('X-Candidatic-Cache', 'MISS');
            res.setHeader('Cache-Control', 'private, max-age=10');
            return finishCandidatesResponse(200, payload);
        }

        // POST /api/candidates - Crear candidato manualmente
        if (req.method === 'POST') {
            const { whatsapp, nombre } = req.body || {};
            if (!whatsapp || !nombre) {
                return res.status(400).json({ success: false, error: 'Número y nombre son requeridos' });
            }
            const cleanPhone = whatsapp.replace(/\D/g, '');
            if (cleanPhone.length < 10) {
                return res.status(400).json({ success: false, error: 'Número inválido (mínimo 10 dígitos)' });
            }

            const { saveCandidate, getCandidateIdByPhone } = await import('./utils/storage.js');

            // Check if candidate already exists
            const existingId = await getCandidateIdByPhone(cleanPhone);
            if (existingId) {
                const existing = await getCandidateById(existingId);
                return res.status(200).json({ success: true, candidate: existing, existed: true });
            }

            const candidate = await saveCandidate({
                whatsapp: cleanPhone,
                nombre: nombre.trim(),
                origen: 'manual_chat',
                esNuevo: 'SI',
                primerContacto: new Date().toISOString(),
                ultimoMensaje: new Date().toISOString()
            });
            clearCandidatesListCache();
            clearFilterCountsCache(redisForMetrics);

            return res.status(201).json({ success: true, candidate, existed: false });
        }

        // PUT /api/candidates - Actualizar candidato
        if (req.method === 'PUT') {
            const body = req.body || {};
            const { id, ...updates } = body;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: 'ID de candidato requerido'
                });
            }

            const { updateCandidate, getCandidateById } = await import('./utils/storage.js');
            const { cleanNameWithAI, detectGender, cleanMunicipioWithAI } = await import('./utils/ai.js');

            // --- AI Logic for Nombre Real ---
            if (updates.nombreReal) {
                const cleanedName = await cleanNameWithAI(updates.nombreReal);
                updates.nombreReal = cleanedName || updates.nombreReal; // Fallback to human input if AI rejects/fails

                // If name changed or gender is missing, trigger gender detection
                const existing = await getCandidateById(id);
                if (!existing.genero || existing.nombreReal !== cleanedName) {
                    const gender = await detectGender(cleanedName);
                    if (gender !== 'Desconocido') {
                        updates.genero = gender;
                    }
                }
            }

            // --- AI Logic for Municipio ---
            if (updates.municipio) {
                const cleanedMunicipio = await cleanMunicipioWithAI(updates.municipio);
                updates.municipio = cleanedMunicipio;
            }

            const updatedCandidate = await updateCandidate(id, updates);
            clearCandidatesListCache();
            clearFilterCountsCache(redisForMetrics);
            // Trigger stats refresh in background (don't block the UI)
            import('./utils/bot-stats.js').then(m => m.calculateBotStats()).catch(() => { });

            return res.status(200).json({
                success: true,
                candidate: updatedCandidate
            });
        }

        // DELETE /api/candidates/:id - Eliminar candidato
        if (req.method === 'DELETE') {
            const { id } = req.query;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: 'ID de candidato requerido'
                });
            }

            await deleteCandidate(id);
            clearCandidatesListCache();
            clearFilterCountsCache(redisForMetrics);
            // Non-blocking background sync
            import('./utils/bot-stats.js').then(m => m.calculateBotStats()).catch(() => { });

            return res.status(200).json({
                success: true,
                message: 'Candidato eliminado correctamente'
            });
        }

        // Método no permitido
        return res.status(405).json({
            error: 'Método no permitido',
            message: 'Solo se aceptan peticiones GET, POST, PUT y DELETE'
        });

    } catch (error) {
        console.error('❌ Error en API de candidatos:', error);

        return res.status(500).json({
            error: 'Error interno del servidor',
            message: globalThis.process?.env?.NODE_ENV === 'development' ? error.message : 'Error procesando solicitud'
        });
    }
}
