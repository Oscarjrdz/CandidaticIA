// ═══════════════════════════════════════════════════════════════════════════════
// FACET INDEX ENGINE  (Envíos Masivos — filtrado facetado nivel Meta/Amazon)
// ═══════════════════════════════════════════════════════════════════════════════
// Índice invertido en Redis: un SET de candidateIds por cada valor de faceta.
// El cruce de filtros (drill-down) se resuelve DENTRO de Redis con SINTERCARD, así
// que por la red solo viajan enteros — nunca perfiles de candidato.
//
// PRINCIPIOS
//  - Un solo escaneo de `candidates:list` alimenta a la vez los conteos legados
//    (candidates.js action=filter_counts) y este índice invertido (una sola pasada).
//  - Materializado desde ese escaneo cacheado (30 min + stale), NO desde la ruta
//    de escritura de mensajes → cero riesgo/escrituras en el camino caliente.
//  - Se invalida al instante en mutaciones del dashboard vía clearFacetIndex().
//
// CLAVES
//  - bulk:idx:v1:all                 → SET universo (todos los candidateIds)
//  - bulk:idx:v1:<dim>:<valor>       → SET de candidateIds con ese valor
//  - bulk:idx:v1:meta                → JSON { generatedAt, total, dims:{dim:[valores]} }
//  - bulk:idx:v1:stale               → copia del payload de conteos (fallback)
//  - bulk:idx:v1:lock                → lock de construcción
// ═══════════════════════════════════════════════════════════════════════════════

import { auditProfile } from './storage.js';
import { recordScanEvent } from './redis-bandwidth.js';

const V = 'bulk:idx:v1';
export const FACET_ALL_KEY = `${V}:all`;
export const FACET_META_KEY = `${V}:meta`;
const FACET_STALE_KEY = `${V}:counts_stale`;
const FACET_LOCK_KEY = `${V}:lock`;
export const FACET_COUNTS_CACHE_KEY = `${V}:counts`;

const INDEX_TTL_SECONDS = 30 * 60;        // 30 min (igual que filter_counts)
const STALE_TTL_SECONDS = 24 * 60 * 60;   // 24 h
const CANDIDATES_LIST_KEY = 'candidates:list';
const CHUNK_SIZE = 500;

const SIN_DATO = 'Sin dato';

// Dimensiones con valores fijos y orden estable para la UI.
export const AGE_BUCKETS = ['18-24', '25-34', '35-44', '45-54', '55+'];
export const ESCOLARIDAD_CANON = ['Primaria', 'Secundaria', 'Preparatoria', 'Técnica', 'Licenciatura', 'Posgrado'];
export const ESTATUS_VALUES = ['completo', 'incompleto'];

// ─── Normalizadores / bucketing (exportados para reuso) ────────────────────────

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const INVALID_TOKENS = new Set(['', '-', 'null', 'n/a', 'na', 'ninguno', 'ninguna', 'none', 'desconocido']);
function isMeaningful(raw) {
    const v = strip(raw);
    if (INVALID_TOKENS.has(v)) return false;
    if (v.length < 2) return false;
    if (v.includes('proporcionad')) return false;
    return true;
}

export function ageBucket(edad) {
    const n = parseInt(edad, 10);
    if (!Number.isFinite(n) || n < 18 || n > 120) return SIN_DATO;
    if (n <= 24) return '18-24';
    if (n <= 34) return '25-34';
    if (n <= 44) return '35-44';
    if (n <= 54) return '45-54';
    return '55+';
}

export function generoCanonico(genero) {
    const v = strip(genero);
    if (!v) return SIN_DATO;
    if (v.includes('muj') || v.includes('fem')) return 'Mujer';
    if (v.includes('hom') || v.includes('masc') || v.includes('var')) return 'Hombre';
    return SIN_DATO;
}

export function escolaridadCanonica(escolaridad) {
    if (!isMeaningful(escolaridad)) return SIN_DATO;
    const v = strip(escolaridad);
    // Nota: chequeamos posgrado/preparatoria/técnica antes que patrones más amplios.
    if (/\b(posgrado|maestria|doctorado|especialidad)\b/.test(v)) return 'Posgrado';
    if (/\b(preparatoria|bachillerato|prepa|prep|cbetis|cbtis|conalep|cecyte|cetis)\b/.test(v)) return 'Preparatoria';
    if (/\b(tecnic|carrera tecnica)\b/.test(v)) return 'Técnica';
    if (/\b(licenciatura|licenc|lic|ingenieria|universidad|uni|profesional)\b/.test(v)) return 'Licenciatura';
    if (/\b(secundaria|secund|secu|sec)\b/.test(v)) return 'Secundaria';
    if (/\b(primaria|prim|elemental)\b/.test(v)) return 'Primaria';
    // Valores ya canónicos que caen aquí por acentos, etc.
    if (v === 'tecnica') return 'Técnica';
    return SIN_DATO;
}

export function municipioCanonico(municipio) {
    if (!isMeaningful(municipio)) return SIN_DATO;
    return String(municipio).trim();
}

function within24h(candidate) {
    const raw = candidate.lastUserMessageAt || candidate.ultimoMensajeUsuario || null;
    if (!raw) return false;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) return false;
    return (Date.now() - t) <= 24 * 60 * 60 * 1000;
}

function candidateTags(candidate) {
    const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
    return tags
        .map(t => (typeof t === 'string' ? t : t?.name))
        .map(t => String(t || '').trim())
        .filter(Boolean);
}

const idxKey = (dim, value) => `${V}:${dim}:${value}`;

// ─── Construcción del índice (un solo escaneo) ─────────────────────────────────

/**
 * Escanea todos los candidatos UNA vez y produce:
 *  - Los sets invertidos bulk:idx:v1:* (para el motor de facetas de Envíos Masivos)
 *  - El payload de conteos legado { ages, genders, municipalities, projects, stepsByProject }
 *    para que candidates.js (action=filter_counts) reuse el mismo escaneo.
 * Devuelve el payload de conteos legado.
 */
export async function buildCandidateFacetIndex(redis, { manualProjects = [], projectLinks = {} } = {}) {
    recordScanEvent(redis, 'facet_index');

    const ids = await redis.zrevrange(CANDIDATES_LIST_KEY, 0, -1);
    const existingCandidateIds = new Set();

    // Conteos legados (compatibilidad con filter_counts).
    const counts = { ages: {}, genders: {}, municipalities: {}, projects: {}, stepsByProject: {} };
    const inc = (map, rawValue) => {
        const value = String(rawValue || '').trim();
        if (!value) return;
        map[value] = (map[value] || 0) + 1;
    };

    // Acumuladores del índice invertido: dim → value → [ids]
    const members = {
        genero: {}, municipio: {}, escolaridad: {}, edad: {}, estatus: {}, ventana24h: {}, tags: {}
    };
    const push = (dim, value, id) => {
        if (!members[dim][value]) members[dim][value] = [];
        members[dim][value].push(id);
    };

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const pipe = redis.pipeline();
        chunk.forEach(id => pipe.get(`candidate:${id}`));
        const rows = await pipe.exec();

        rows.forEach(([err, raw]) => {
            if (err || !raw) return;
            let c;
            try { c = JSON.parse(raw); } catch { return; }
            if (!c?.id) return;
            const id = String(c.id);
            existingCandidateIds.add(id);

            // Conteos legados
            inc(counts.ages, c.edad);
            inc(counts.genders, c.genero);
            inc(counts.municipalities, c.municipio);
            inc(counts.projects, c.manualProjectId);

            // Índice invertido facetado
            push('genero', generoCanonico(c.genero), id);
            push('municipio', municipioCanonico(c.municipio), id);
            push('escolaridad', escolaridadCanonica(c.escolaridad), id);
            push('edad', ageBucket(c.edad), id);
            push('estatus', auditProfile(c).isComplete ? 'completo' : 'incompleto', id);
            if (within24h(c)) push('ventana24h', 'si', id);
            candidateTags(c).forEach(t => push('tags', t, id));
        });
    }

    // Steps por proyecto (compatibilidad con filter_counts) — reusa links ya cargados.
    (Array.isArray(manualProjects) ? manualProjects : []).forEach(project => {
        if (!project?.id) return;
        const validStepIds = new Set((project.steps || []).map(s => String(s.id || '').trim()).filter(Boolean));
        const links = Array.isArray(projectLinks[project.id]) ? projectLinks[project.id] : [];
        links.forEach(link => {
            const candidateId = String(link?.candidateId || '').trim();
            const stepId = String(link?.stepId || '').trim();
            if (!candidateId || !existingCandidateIds.has(candidateId)) return;
            if (validStepIds.size > 0 && (!stepId || !validStepIds.has(stepId))) return;
            if (stepId) {
                if (!counts.stepsByProject[project.id]) counts.stepsByProject[project.id] = {};
                inc(counts.stepsByProject[project.id], stepId);
            }
        });
    });

    // ── Escribir el índice invertido en Redis (pipeline, borrando la versión anterior) ──
    const dims = {};
    const writePipe = redis.pipeline();

    // Universo
    const allIds = [...existingCandidateIds];
    writePipe.del(FACET_ALL_KEY);
    for (let i = 0; i < allIds.length; i += 2000) {
        const slice = allIds.slice(i, i + 2000);
        if (slice.length) writePipe.sadd(FACET_ALL_KEY, ...slice);
    }
    writePipe.expire(FACET_ALL_KEY, STALE_TTL_SECONDS);

    for (const dim of Object.keys(members)) {
        const values = members[dim];
        dims[dim] = [];
        for (const value of Object.keys(values)) {
            const memberIds = values[value];
            const key = idxKey(dim, value);
            writePipe.del(key);
            for (let i = 0; i < memberIds.length; i += 2000) {
                writePipe.sadd(key, ...memberIds.slice(i, i + 2000));
            }
            writePipe.expire(key, STALE_TTL_SECONDS);
            dims[dim].push(value);
        }
    }

    // Ordenar valores de dimensiones fijas para la UI
    const orderBy = (arr, order) => {
        const rank = new Map(order.map((v, i) => [v, i]));
        return arr.slice().sort((a, b) => {
            if (a === SIN_DATO) return 1;
            if (b === SIN_DATO) return -1;
            const ra = rank.has(a) ? rank.get(a) : 999;
            const rb = rank.has(b) ? rank.get(b) : 999;
            return ra - rb;
        });
    };
    if (dims.edad) dims.edad = orderBy(dims.edad, AGE_BUCKETS);
    if (dims.escolaridad) dims.escolaridad = orderBy(dims.escolaridad, ESCOLARIDAD_CANON);
    if (dims.estatus) dims.estatus = orderBy(dims.estatus, ESTATUS_VALUES);
    if (dims.genero) dims.genero = orderBy(dims.genero, ['Hombre', 'Mujer']);
    // municipio y tags: alfabético (Sin dato al final)
    const alpha = (arr) => arr.slice().sort((a, b) => {
        if (a === SIN_DATO) return 1;
        if (b === SIN_DATO) return -1;
        return a.localeCompare(b, 'es');
    });
    if (dims.municipio) dims.municipio = alpha(dims.municipio);
    if (dims.tags) dims.tags = alpha(dims.tags);

    const meta = { generatedAt: new Date().toISOString(), total: existingCandidateIds.size, dims };
    writePipe.set(FACET_META_KEY, JSON.stringify(meta), 'EX', STALE_TTL_SECONDS);

    await writePipe.exec().catch((e) => {
        console.error('[FACET INDEX] Error escribiendo índice:', e?.message);
    });

    return { counts: { ...counts, total: ids.length, generatedAt: meta.generatedAt }, meta };
}

// ─── Frescura: cache de conteos legados + lock (reusado por candidates.js) ──────

/**
 * Devuelve el payload de conteos legado, construyendo el índice si hace falta.
 * Mantiene el mismo comportamiento cache/lock/stale que el buildFilterCounts previo.
 */
export async function getFilterCountsWithIndex(redis, projectLoader) {
    const cached = await redis.get(FACET_COUNTS_CACHE_KEY).catch(() => null);
    if (cached) return JSON.parse(cached);

    const lockValue = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const lockAcquired = await redis.set(FACET_LOCK_KEY, lockValue, 'EX', 60, 'NX').catch(() => null);

    if (lockAcquired !== 'OK') {
        const stale = await redis.get(FACET_STALE_KEY).catch(() => null);
        if (stale) return JSON.parse(stale);
        for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 250));
            const fresh = await redis.get(FACET_COUNTS_CACHE_KEY).catch(() => null);
            if (fresh) return JSON.parse(fresh);
        }
    } else {
        const fresh = await redis.get(FACET_COUNTS_CACHE_KEY).catch(() => null);
        if (fresh) {
            await redis.del(FACET_LOCK_KEY).catch(() => {});
            return JSON.parse(fresh);
        }
    }

    const projectData = typeof projectLoader === 'function' ? await projectLoader() : {};
    const { counts } = await buildCandidateFacetIndex(redis, projectData);

    const payloadRaw = JSON.stringify(counts);
    const pipe = redis.pipeline();
    pipe.set(FACET_COUNTS_CACHE_KEY, payloadRaw, 'EX', INDEX_TTL_SECONDS);
    pipe.set(FACET_STALE_KEY, payloadRaw, 'EX', STALE_TTL_SECONDS);
    if (lockAcquired === 'OK') pipe.del(FACET_LOCK_KEY);
    await pipe.exec().catch(() => {});
    return counts;
}

/**
 * Asegura que el índice invertido (meta + sets) exista y esté fresco.
 * Reconstruye si el meta no existe (expiró o fue invalidado).
 */
export async function ensureFacetIndex(redis, projectLoader) {
    const meta = await redis.get(FACET_META_KEY).catch(() => null);
    if (meta) return JSON.parse(meta);
    // Reusa el mismo build/lock que los conteos (una sola construcción).
    await getFilterCountsWithIndex(redis, projectLoader);
    let fresh = await redis.get(FACET_META_KEY).catch(() => null);
    // Si otro proceso tenía el lock, esta llamada devolvió conteos stale SIN construir
    // el índice/meta. Esperamos brevemente a que ese build termine antes de rendirnos.
    for (let i = 0; !fresh && i < 12; i++) {
        await new Promise(r => setTimeout(r, 250));
        fresh = await redis.get(FACET_META_KEY).catch(() => null);
    }
    return fresh ? JSON.parse(fresh) : { total: 0, dims: {} };
}

/** Invalida índice + conteos. Rebuild perezoso en la siguiente petición. */
export function clearFacetIndex(redis) {
    if (!redis) return;
    // Borramos meta+cache; los sets viejos quedan con TTL y se sobreescriben (del+sadd)
    // en el próximo build. No hacemos SCAN aquí (sería caro con muchos valores).
    redis.del(FACET_META_KEY, FACET_COUNTS_CACHE_KEY).catch(() => {});
}

// ─── Consulta facetada (drill-down) ────────────────────────────────────────────

// SINTERCARD (Redis 7+) evita claves temporales. Detectamos soporte una vez.
let sintercardSupported = null;
async function countIntersection(redis, keys) {
    if (!keys.length) return 0;
    if (keys.length === 1) return redis.scard(keys[0]).catch(() => 0);
    if (sintercardSupported !== false) {
        try {
            const n = await redis.call('SINTERCARD', String(keys.length), ...keys);
            sintercardSupported = true;
            return Number(n) || 0;
        } catch (e) {
            sintercardSupported = false;
        }
    }
    // Fallback universal: SINTERSTORE a clave temporal + SCARD
    const tmp = `${V}:q:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    try {
        await redis.sinterstore(tmp, ...keys);
        const n = await redis.scard(tmp);
        return Number(n) || 0;
    } catch { return 0; }
    finally { redis.del(tmp).catch(() => {}); }
}

/**
 * Normaliza la selección del cliente a { dim: [values] } de dimensiones restringidas,
 * creando (si hace falta) claves de unión temporales para dimensiones multi-valor.
 * Devuelve { constraints: { dim: key }, tempKeys: [] }.
 */
async function buildConstraintKeys(redis, selection) {
    const constraints = {};
    const tempKeys = [];
    const dimsMulti = ['genero', 'municipio', 'escolaridad', 'edad', 'tags'];

    for (const dim of dimsMulti) {
        const vals = Array.isArray(selection?.[dim]) ? selection[dim].filter(Boolean) : [];
        if (vals.length === 0) continue;
        if (vals.length === 1) {
            constraints[dim] = idxKey(dim, vals[0]);
        } else {
            const tmp = `${V}:u:${dim}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
            await redis.sunionstore(tmp, ...vals.map(v => idxKey(dim, v))).catch(() => {});
            await redis.pexpire(tmp, 8000).catch(() => {});
            constraints[dim] = tmp;
            tempKeys.push(tmp);
        }
    }

    // Dimensiones single-value
    if (selection?.estatus && ESTATUS_VALUES.includes(selection.estatus)) {
        constraints.estatus = idxKey('estatus', selection.estatus);
    }
    if (selection?.ventana24h === true || selection?.ventana24h === 'si') {
        constraints.ventana24h = idxKey('ventana24h', 'si');
    }

    return { constraints, tempKeys };
}

/**
 * Calcula el total del segmento y los conteos drill-down por valor de cada dimensión.
 * @returns { total, counts: { dim: { value: count } } }
 */
export async function computeFacets(redis, selection, meta) {
    const { constraints, tempKeys } = await buildConstraintKeys(redis, selection);
    try {
        const constraintDims = Object.keys(constraints);

        // Total: intersección de universo + todas las restricciones activas
        const total = await countIntersection(redis, [FACET_ALL_KEY, ...constraintDims.map(d => constraints[d])]);

        // Drill-down: por dimensión D y valor v → intersección de (universo + restricciones
        // de las OTRAS dimensiones + set(D,v)). Así el conteo de cada valor refleja lo que
        // pasaría si además se eligiera v, dado el resto de la selección ("todo depende de todo").
        const counts = {};
        const dims = meta?.dims || {};
        for (const dim of Object.keys(dims)) {
            counts[dim] = {};
            const baseKeys = [FACET_ALL_KEY, ...constraintDims.filter(d => d !== dim).map(d => constraints[d])];
            // Lanzamos todos los valores de la dimensión en paralelo (pipeline lógico).
            const values = dims[dim];
            const results = await Promise.all(
                values.map(v => countIntersection(redis, [...baseKeys, idxKey(dim, v)]))
            );
            values.forEach((v, i) => { counts[dim][v] = results[i]; });
        }

        return { total, counts };
    } finally {
        if (tempKeys.length) redis.del(...tempKeys).catch(() => {});
    }
}

/**
 * Resuelve la lista COMPLETA de candidateIds del segmento, ordenada por recencia
 * (misma que candidates:list), restando excludeIds. limit=0 → todos.
 */
export async function resolveSegmentIds(redis, selection, excludeIds = [], limit = 0) {
    const { constraints, tempKeys } = await buildConstraintKeys(redis, selection);
    const localTemps = [];
    try {
        const constraintKeys = Object.keys(constraints).map(d => constraints[d]);

        let orderedZset;
        if (constraintKeys.length === 0) {
            orderedZset = CANDIDATES_LIST_KEY;
        } else {
            // Intersección de sets → set resultado
            const resultSet = `${V}:r:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
            await redis.sinterstore(resultSet, FACET_ALL_KEY, ...constraintKeys).catch(() => {});
            localTemps.push(resultSet);
            // Ordenar por recencia: intersectar con el zset candidates:list conservando su score
            const orderedTmp = `${V}:z:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
            await redis.zinterstore(orderedTmp, 2, CANDIDATES_LIST_KEY, resultSet, 'WEIGHTS', 1, 0).catch(() => {});
            localTemps.push(orderedTmp);
            orderedZset = orderedTmp;
        }

        const stop = limit > 0 ? limit - 1 : -1;
        let ids = await redis.zrevrange(orderedZset, 0, stop).catch(() => []);

        if (excludeIds && excludeIds.length) {
            const ex = new Set(excludeIds.map(String));
            ids = ids.filter(id => !ex.has(String(id)));
        }
        return ids;
    } finally {
        const toDel = [...tempKeys, ...localTemps];
        if (toDel.length) redis.del(...toDel).catch(() => {});
        if (localTemps.length) localTemps.forEach(k => redis.pexpire(k, 1).catch(() => {}));
    }
}

/** Hidrata una vista previa acotada (solo estos ids) para la UI. */
const PREVIEW_HEAVY_FIELDS = ['adBody', 'adImageUrl', 'adUrl', 'adClickId'];
export async function hydratePreview(redis, ids) {
    if (!ids?.length) return [];
    const pipe = redis.pipeline();
    ids.forEach(id => pipe.get(`candidate:${id}`));
    const rows = await pipe.exec().catch(() => []);
    const out = [];
    (rows || []).forEach(([err, raw]) => {
        if (err || !raw) return;
        try {
            const c = JSON.parse(raw);
            const trimmed = {
                id: c.id,
                nombre: c.nombre,
                nombreReal: c.nombreReal,
                whatsapp: c.whatsapp,
                genero: c.genero,
                edad: c.edad,
                municipio: c.municipio,
                escolaridad: c.escolaridad,
                tags: c.tags,
                campaignName: c.campaignName,
                primerContacto: c.primerContacto,
                createdAt: c.createdAt,
                lastUserMessageAt: c.lastUserMessageAt
            };
            for (const f of PREVIEW_HEAVY_FIELDS) delete trimmed[f];
            out.push(trimmed);
        } catch { /* ignore */ }
    });
    return out;
}
