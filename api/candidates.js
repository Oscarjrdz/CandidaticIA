/**
 * Endpoint para gestionar candidatos
 * GET /api/candidates?limit=50&offset=0&search=
 * GET /api/candidates/:id
 * DELETE /api/candidates/:id
 */

// NO TOP LEVEL IMPORTS to prevent boot crashes
const CANDIDATES_LIST_CACHE_TTL_MS = 15000;
// 30 min: cada rebuild lee los ~13.6k blobs de candidato completos (~14 MB de salida),
// así que menos rebuilds = ahorro directo de ancho de banda. Las mutaciones del dashboard
// (alta/edición/borrado) siguen invalidando al instante vía clearFilterCountsCache, así
// que las acciones del usuario se reflejan de inmediato; solo el refresco pasivo pasa de
// 15 a 30 min. Los cambios que entran por WhatsApp ya no invalidaban este caché (nunca lo
// hicieron), así que su lag ya era de hasta 15 min — esto solo lo extiende un poco.
// Los conteos de filtros y el índice invertido facetado se construyen de un SOLO
// escaneo compartido en api/utils/facet-index.js (cache 30 min + stale + lock).
const FILTER_COUNTS_CACHE_KEY = 'cache:candidates:filter_counts:v1'; // legado (se limpia en invalidación)
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
    redis.del(FILTER_COUNTS_CACHE_KEY).catch(() => {}); // legado
    // Invalida conteos + índice invertido facetado (rebuild perezoso en la próxima petición).
    import('./utils/facet-index.js').then(m => m.clearFacetIndex(redis)).catch(() => {});
}

// Carga proyectos manuales + sus links para el conteo de steps (usado por el escaneo único).
async function loadManualProjectData(redis) {
    const projectsRaw = await redis.get(MANUAL_PROJECTS_KEY).catch(() => null);
    const projects = projectsRaw ? JSON.parse(projectsRaw) : [];
    const projectLinks = {};
    await Promise.all((Array.isArray(projects) ? projects : []).map(async project => {
        if (!project?.id) return;
        const linksRaw = await redis.get(`${MANUAL_PROJECT_LINKS_PREFIX}${project.id}`).catch(() => null);
        try { projectLinks[project.id] = linksRaw ? JSON.parse(linksRaw) : []; } catch { projectLinks[project.id] = []; }
    }));
    return { manualProjects: Array.isArray(projects) ? projects : [], projectLinks };
}

// Delega en el motor compartido: un solo escaneo alimenta conteos + índice invertido.
async function buildFilterCounts(redis) {
    const { getFilterCountsWithIndex } = await import('./utils/facet-index.js');
    return getFilterCountsWithIndex(redis, () => loadManualProjectData(redis));
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
            const { limit = '100', offset = '0', search = '', stats, id, excludeLinked = 'false', tag = '', unreadFirst = 'false', filter = '', unreadOnly = 'false', action = '', manualProjectId = '', manualStepId = '' } = req.query;

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
                unreadOnly: String(unreadOnly || ''),
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

            // Modo unreadFirst con tag activo y primera página: no-leídos con ese tag primero.
            // Acepta ademas un filtro de estado (unread/complete/incomplete + unreadOnly) que
            // se intersecta en el servidor — evita hidratar todo el tag para descartar en cliente.
            if (unreadFirst === 'true' && tag && !search && excludeLinked !== 'true') {
                const safeLimit = parseInt(limit, 10) || 33;
                const safeOffset = parseInt(offset, 10) || 0;
                const statusFilter = ['unread', 'complete', 'incomplete'].includes(filter) ? filter : '';
                const { candidates, total } = await getCandidatesUnreadFirstByTag(tag, safeLimit, safeOffset, statusFilter, unreadOnly === 'true');
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
