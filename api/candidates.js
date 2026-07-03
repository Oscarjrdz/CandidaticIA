/**
 * Endpoint para gestionar candidatos
 * GET /api/candidates?limit=50&offset=0&search=
 * GET /api/candidates/:id
 * DELETE /api/candidates/:id
 */

// NO TOP LEVEL IMPORTS to prevent boot crashes
const CANDIDATES_LIST_CACHE_TTL_MS = 15000;
const FILTER_COUNTS_CACHE_TTL_SECONDS = 60;
const candidatesListCache = new Map();

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
    redis.del('cache:candidates:filter_counts:v1').catch(() => {});
}

function incrementCount(map, rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return;
    map[value] = (map[value] || 0) + 1;
}

async function buildFilterCounts(redis) {
    const cached = await redis.get('cache:candidates:filter_counts:v1');
    if (cached) return JSON.parse(cached);

    const ids = await redis.zrevrange('candidates:list', 0, -1);
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
                incrementCount(counts.ages, c.edad);
                incrementCount(counts.genders, c.genero);
                incrementCount(counts.municipalities, c.municipio);

                if (c.manualProjectId) {
                    incrementCount(counts.projects, c.manualProjectId);
                    if (c.manualProjectStepId) {
                        if (!counts.stepsByProject[c.manualProjectId]) counts.stepsByProject[c.manualProjectId] = {};
                        incrementCount(counts.stepsByProject[c.manualProjectId], c.manualProjectStepId);
                    }
                }
            } catch {}
        });
    }

    const payload = { ...counts, total: ids.length, generatedAt: new Date().toISOString() };
    await redis.set('cache:candidates:filter_counts:v1', JSON.stringify(payload), 'EX', FILTER_COUNTS_CACHE_TTL_SECONDS).catch(() => {});
    return payload;
}

function buildCandidatesListPayload({ candidates = [], total = 0, limit = 100, offset = 0, statsData = null }) {
    const safeLimit = Math.max(1, parseInt(limit, 10) || 100);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const count = Array.isArray(candidates) ? candidates.length : 0;
    const nextOffset = safeOffset + count;

    return {
        success: true,
        count,
        total: safeTotal,
        candidates,
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
        const { recordUsageMetric, estimateJsonBytes } = await import('./utils/usage-metrics.js');
        const redisForMetrics = getRedisClient();
        const finishCandidatesResponse = async (status, payload, metric = {}) => {
            await recordUsageMetric(redisForMetrics, '/api/candidates', {
                ...metric,
                responseBytes: estimateJsonBytes(payload)
            });
            return res.status(status).json(payload);
        };

        // Validar sesión admin
        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        // GET /api/candidates - Obtener lista o estadísticas
        if (req.method === 'GET') {
            const { limit = '100', offset = '0', search = '', stats, id, excludeLinked = 'false', tag = '', unreadFirst = 'false', filter = '', action = '' } = req.query;

            if (action === 'filter_counts') {
                const counts = await buildFilterCounts(redisForMetrics);
                return finishCandidatesResponse(200, { success: true, counts }, {
                    cacheScope: 'filter_counts',
                    estimatedRedisBytes: estimateJsonBytes(counts)
                });
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
                }, {
                    candidateReads: 1,
                    estimatedRedisBytes: estimateJsonBytes(candidate)
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
                filter: String(filter || '')
            });
            const cachedPayload = getCachedCandidatesList(cacheKey);
            if (cachedPayload) {
                res.setHeader('X-Candidatic-Cache', 'HIT');
                res.setHeader('Cache-Control', 'private, max-age=10');
                return finishCandidatesResponse(200, cachedPayload, { cacheHit: true });
            }

            // Modo filtro servidor: unread / complete / incomplete (sin tag ni búsqueda)
            if (['unread', 'complete', 'incomplete'].includes(filter) && !search && !tag) {
                const safeLimit = parseInt(limit, 10) || 500;
                const safeOffset = parseInt(offset, 10) || 0;
                const { candidates, total } = await getCandidatesFiltered(filter, safeLimit, safeOffset);
                const payload = buildCandidatesListPayload({ candidates, total, limit: safeLimit, offset: safeOffset });
                setCachedCandidatesList(cacheKey, payload);
                res.setHeader('X-Candidatic-Cache', 'MISS');
                res.setHeader('Cache-Control', 'private, max-age=10');
                return finishCandidatesResponse(200, payload, {
                    cacheMiss: true,
                    candidateReads: candidates.length,
                    estimatedRedisBytes: estimateJsonBytes(candidates)
                });
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
                return finishCandidatesResponse(200, payload, {
                    cacheMiss: true,
                    candidateReads: candidates.length,
                    estimatedRedisBytes: estimateJsonBytes(candidates)
                });
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
                return finishCandidatesResponse(200, payload, {
                    cacheMiss: true,
                    candidateReads: candidates.length,
                    estimatedRedisBytes: estimateJsonBytes(candidates)
                });
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
            return finishCandidatesResponse(200, payload, {
                cacheMiss: true,
                candidateReads: candidates.length,
                estimatedRedisBytes: estimateJsonBytes(candidates),
                fullScan: !!(search || excludeLinked === 'true')
            });
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
