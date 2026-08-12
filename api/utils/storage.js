/**
 * Storage Utility - Redis (ioredis) Implementation
 * Pattern: Distributed Keys (ZSET + String)
 * AUTH ENABLED
 */

/**
 * Candidatic Storage Utilities
 * Deployment Trigger: 2026-02-20T18:48:00
 */
import Redis from 'ioredis';
import { sendConversionEvent } from './metaConversions.js';
import { getCachedConfig } from './cache.js';
import { recordScanEvent } from './redis-bandwidth.js';
import { acquireProcessingLock, releaseProcessingLock } from './reminder-lock.js';

// Initialize Redis client
let redis;
let redisIdleTimer = null;
const REDIS_IDLE_DISCONNECT_MS = Number(process.env.REDIS_IDLE_DISCONNECT_MS || 120_000);

function scheduleRedisIdleDisconnect() {
    if (!REDIS_IDLE_DISCONNECT_MS || REDIS_IDLE_DISCONNECT_MS < 1_000) return;
    if (redisIdleTimer) clearTimeout(redisIdleTimer);
    redisIdleTimer = setTimeout(() => {
        const client = redis;
        if (!client) return;

        redis = null;
        redisIdleTimer = null;
        client.quit().catch(() => client.disconnect());
    }, REDIS_IDLE_DISCONNECT_MS);
    if (typeof redisIdleTimer.unref === 'function') redisIdleTimer.unref();
}

const getClient = () => {
    if (!redis || ['end', 'close'].includes(redis.status)) {
        if (redisIdleTimer) {
            clearTimeout(redisIdleTimer);
            redisIdleTimer = null;
        }
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        const isTLS = redisUrl.startsWith('rediss://');

        try {
            console.log(`🔌 Connecting to Redis: ${redisUrl.split('@').pop()} (TLS: ${isTLS})`);
            redis = new Redis(redisUrl, {
                retryStrategy: (times) => Math.min(times * 50, 2000),
                tls: isTLS ? { rejectUnauthorized: true } : undefined
            });
            redis.on('error', (err) => console.error('❌ Redis Connection Error:', err));
            redis.on('end', () => { redisIdleTimer = null; });
        } catch (e) {
            console.error('❌ Failed to create Redis client:', e);
        }
    }
    scheduleRedisIdleDisconnect();
    return redis;
};

// Initialize on load
// getClient(); // Commented to avoid import hangs during static load

// Export wrapper that always ensures client is returned (or tries to init again)
export const getRedisClient = () => {
    if (!redis) return getClient();
    return redis;
};

// ==========================================
// KEYS MAP
// ==========================================
const KEYS = {
    // Blob Style
    USERS: 'candidatic_users',
    ROLES: 'candidatic_roles',
    VACANCIES: 'candidatic_vacancies',

    // Auth
    AUTH_PREFIX: 'auth_pin_',

    // Distributed Style (ZSET + Keys)
    CANDIDATES_LIST: 'candidates:list',
    CANDIDATE_PREFIX: 'candidate:',
    EVENTS_LIST: 'webhook:events',
    PHONE_INDEX: 'candidatic:phone_index',
    DEDUPE_PREFIX: 'webhook:processed:',

    // Stats
    STATS_INCOMING: 'stats:msg:incoming',
    STATS_OUTGOING: 'stats:msg:outgoing',

    // Projects (New)
    PROJECT_PREFIX: 'project:',
    PROJECTS_LIST: 'projects:all',
    PROJECT_CANDIDATES_PREFIX: 'project:candidates:',
    PROJECT_SEARCHES_PREFIX: 'project:searches:',
    PROJECT_CANDIDATE_METADATA_PREFIX: 'project:cand_meta:',
    CANDIDATE_PROJECT_LINK: 'index:cand_project', // Reverse index: candidateId -> projectId

    // Telemetry & Observability (Titan Standard)
    TELEMETRY_AI_LOGS: 'telemetry:ai:events', // List of recent AI events
    CANDIDATE_LOCK_PREFIX: 'lock:candidate:', // Per-candidate processing lock
    CANDIDATE_WAITLIST_PREFIX: 'waitlist:candidate:', // Pending messages while processing

    // Optimized Statistics Sets (O(1) scard)
    LIST_COMPLETE: 'stats:list:complete',
    LIST_PENDING: 'stats:list:pending',
    CANDIDATES_UNREAD: 'candidates:unread',

    // ByPass Rules (New)
    BYPASS_LIST: 'bypass:list',
    BYPASS_PREFIX: 'bypass:'
};

const INDEX_KEYS = {
    TAG_PREFIX: 'index:candidates:tag:',
    AD_PREFIX: 'index:candidates:ad:',
    MANUAL_PROJECT_PREFIX: 'index:candidates:manual_project:v2:',
    MANUAL_PROJECT_STEP_PREFIX: 'index:candidates:manual_project_step:v2:',
    MANUAL_READY: 'index:candidates:manual_project:v2:ready',
    MANUAL_LOCK: 'index:candidates:manual_project:v2:lock',
    UNTAGGED: 'index:candidates:untagged',
    UNTAGGED_READY: 'index:candidates:untagged:ready',
    UNTAGGED_LOCK: 'index:candidates:untagged:lock',
    READY: 'index:candidates:secondary:ready',
    LOCK: 'index:candidates:secondary:lock'
};
const UNTAGGED_TAG_FILTER = '__candidatic_untagged__';
const UNTAGGED_COUNT_KEY = 'candidatic:untagged_count';
export const MANUAL_PROJECT_LINKS_PREFIX = 'crm_links:';
export const HUMAN_INTERVENTION_SILENCE_MS = 5 * 24 * 60 * 60 * 1000;

const CRM_LINKS_LOCK_SCOPE = 'crm_links';
const CRM_LINKS_LOCK_TTL_SECONDS = 10;
const CRM_LINKS_LOCK_MAX_WAIT_MS = 3000;
const CRM_LINKS_LOCK_RETRY_MS = 60;

// TODA escritura a crm_links:{projectId} (vincular/desvincular/mover/reordenar
// candidatos — desde Flujos en flow-engine.js o desde el tablero CRM manual en
// manual_projects.js) DEBE pasar por aquí. Es un blob JSON único por proyecto: leer
// todo, modificar en memoria, reescribir todo — no atómico por sí mismo. Sin candado,
// dos escrituras concurrentes al MISMO proyecto (dos flujos corriendo casi juntos, o un
// flujo corriendo mientras un reclutador arrastra una tarjeta) se pisan: la segunda
// sobreescribe a la primera completa y el candidato que perdió la carrera desaparece sin
// ningún error visible (bug real confirmado en producción, agosto 2026, campaña "Hr One
// México" — 2 de 11 candidatos que sí cumplían todas las condiciones del flujo nunca se
// vincularon a su proyecto).
//
// `mutate(links)` recibe el array actual y debe devolver `{ links, result }` — `links`
// es el array nuevo a guardar (o `undefined`/`null` si no hubo cambios, para no
// reescribir de más), `result` es lo que el caller necesita de vuelta.
export async function withCrmProjectLinksLock(projectId, mutate) {
    const client = getRedisClient();
    if (!client) return null;
    const key = `${MANUAL_PROJECT_LINKS_PREFIX}${projectId}`;

    let lock = null;
    const deadline = Date.now() + CRM_LINKS_LOCK_MAX_WAIT_MS;
    while (!lock) {
        lock = await acquireProcessingLock(client, CRM_LINKS_LOCK_SCOPE, projectId, CRM_LINKS_LOCK_TTL_SECONDS);
        if (lock || Date.now() >= deadline) break;
        await new Promise(r => setTimeout(r, CRM_LINKS_LOCK_RETRY_MS));
    }
    if (!lock) {
        console.error(`[CRM-LINKS] No se pudo tomar el candado para el proyecto ${projectId} tras ${CRM_LINKS_LOCK_MAX_WAIT_MS}ms de contención — se procede sin candado para no bloquear indefinidamente.`);
    }

    try {
        const raw = await client.get(key);
        const links = raw ? JSON.parse(raw) : [];
        const { links: nextLinks, result } = await mutate(links);
        if (nextLinks) await client.set(key, JSON.stringify(nextLinks));
        return result;
    } finally {
        if (lock) await releaseProcessingLock(client, lock);
    }
}

const indexPart = (value) => Buffer.from(String(value || '').trim().toLowerCase()).toString('base64url');
const tagIndexKey = (tag) => `${INDEX_KEYS.TAG_PREFIX}${indexPart(typeof tag === 'string' ? tag : tag?.name)}`;
const adIndexKey = (adId) => `${INDEX_KEYS.AD_PREFIX}${indexPart(adId)}`;
const manualProjectIndexKey = (projectId) => `${INDEX_KEYS.MANUAL_PROJECT_PREFIX}${indexPart(projectId)}`;
const manualProjectStepIndexKey = (projectId, stepId) => `${INDEX_KEYS.MANUAL_PROJECT_STEP_PREFIX}${indexPart(`${projectId}::${stepId}`)}`;
const cleanTagValues = (tags) => [...new Set((Array.isArray(tags) ? tags : [])
    .map(t => typeof t === 'string' ? t : t?.name)
    .map(t => String(t || '').trim())
    .filter(Boolean))];
const candidateSortScore = (candidate = {}) => {
    const score = new Date(candidate.ultimoMensaje || candidate.primerContacto || Date.now()).getTime();
    return Number.isFinite(score) ? score : Date.now();
};

function normalizeCandidateSilence(candidate, nowMs = Date.now()) {
    if (!candidate || candidate.blocked !== true || !candidate.blockedExpiresAt) return candidate;
    const expiresMs = new Date(candidate.blockedExpiresAt).getTime();
    if (!Number.isFinite(expiresMs) || expiresMs > nowMs) return candidate;

    return {
        ...candidate,
        blocked: false,
        blockedExpiredAt: new Date(nowMs).toISOString()
    };
}

function persistExpiredSilence(client, originalCandidate, normalizedCandidate) {
    if (!client || !originalCandidate || originalCandidate === normalizedCandidate) return;
    if (originalCandidate.blocked !== true || normalizedCandidate.blocked === true) return;
    client.set(`${KEYS.CANDIDATE_PREFIX}${normalizedCandidate.id}`, JSON.stringify(normalizedCandidate)).catch(() => {});
}

async function syncCandidateSecondaryIndexes(client, oldCandidate = null, newCandidate = null) {
    if (!client) return;
    const id = newCandidate?.id || oldCandidate?.id;
    if (!id || String(id).startsWith('sim_')) return;

    const oldTags = new Set(cleanTagValues(oldCandidate?.tags));
    const newTags = new Set(cleanTagValues(newCandidate?.tags));
    const oldAd = oldCandidate?.adId ? String(oldCandidate.adId).trim() : '';
    const newAd = newCandidate?.adId ? String(newCandidate.adId).trim() : '';
    const oldManualProject = oldCandidate?.manualProjectId ? String(oldCandidate.manualProjectId).trim() : '';
    const newManualProject = newCandidate?.manualProjectId ? String(newCandidate.manualProjectId).trim() : '';
    const oldManualStep = oldCandidate?.manualProjectStepId ? String(oldCandidate.manualProjectStepId).trim() : '';
    const newManualStep = newCandidate?.manualProjectStepId ? String(newCandidate.manualProjectStepId).trim() : '';
    const wasUntagged = oldCandidate && oldTags.size === 0;
    const isUntagged = newCandidate && newTags.size === 0;

    const pipe = client.pipeline();
    for (const tag of oldTags) if (!newTags.has(tag)) pipe.srem(tagIndexKey(tag), id);
    for (const tag of newTags) if (!oldTags.has(tag)) pipe.sadd(tagIndexKey(tag), id);
    if (oldAd && oldAd !== newAd) pipe.srem(adIndexKey(oldAd), id);
    if (newAd && oldAd !== newAd) pipe.sadd(adIndexKey(newAd), id);
    if (oldManualProject && oldManualProject !== newManualProject) pipe.srem(manualProjectIndexKey(oldManualProject), id);
    if (newManualProject && oldManualProject !== newManualProject) pipe.sadd(manualProjectIndexKey(newManualProject), id);
    if (oldManualProject && oldManualStep && (oldManualProject !== newManualProject || oldManualStep !== newManualStep)) {
        pipe.srem(manualProjectStepIndexKey(oldManualProject, oldManualStep), id);
    }
    if (newManualProject && newManualStep && (oldManualProject !== newManualProject || oldManualStep !== newManualStep)) {
        pipe.sadd(manualProjectStepIndexKey(newManualProject, newManualStep), id);
    }
    if (wasUntagged && !isUntagged) pipe.zrem(INDEX_KEYS.UNTAGGED, id);
    if (isUntagged) pipe.zadd(INDEX_KEYS.UNTAGGED, candidateSortScore(newCandidate), id);
    await pipe.exec().catch(() => {});
}

async function ensureCandidateManualIndexes() {
    const client = getRedisClient();
    if (!client) return false;
    const ready = await client.get(INDEX_KEYS.MANUAL_READY).catch(() => null);
    if (ready === '1') return true;

    const locked = await client.set(INDEX_KEYS.MANUAL_LOCK, '1', 'EX', 300, 'NX').catch(() => null);
    if (!locked) {
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 250));
            const nowReady = await client.get(INDEX_KEYS.MANUAL_READY).catch(() => null);
            if (nowReady === '1') return true;
        }
        return false;
    }

    try {
        const total = (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
        const CHUNK = 500;
        for (let offset = 0; offset < total; offset += CHUNK) {
            const ids = await client.zrevrange(KEYS.CANDIDATES_LIST, offset, offset + CHUNK - 1);
            if (!ids?.length) break;
            const readPipe = client.pipeline();
            ids.forEach(id => readPipe.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
            const rows = await readPipe.exec();
            const writePipe = client.pipeline();
            for (const [err, raw] of rows) {
                if (err || !raw) continue;
                let c;
                try { c = JSON.parse(raw); } catch { continue; }
                if (!c?.id) continue;
                const projectId = String(c.manualProjectId || '').trim();
                const stepId = String(c.manualProjectStepId || '').trim();
                if (!projectId) continue;
                writePipe.sadd(manualProjectIndexKey(projectId), c.id);
                if (stepId) writePipe.sadd(manualProjectStepIndexKey(projectId, stepId), c.id);
            }
            await writePipe.exec();
            await new Promise(r => setTimeout(r, 2));
        }
        await client.set(INDEX_KEYS.MANUAL_READY, '1');
        return true;
    } finally {
        await client.del(INDEX_KEYS.MANUAL_LOCK).catch(() => {});
    }
}

async function ensureCandidateUntaggedIndex() {
    const client = getRedisClient();
    if (!client) return false;
    const ready = await client.get(INDEX_KEYS.UNTAGGED_READY).catch(() => null);
    if (ready === '1') return true;

    const locked = await client.set(INDEX_KEYS.UNTAGGED_LOCK, '1', 'EX', 300, 'NX').catch(() => null);
    if (!locked) {
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 250));
            const nowReady = await client.get(INDEX_KEYS.UNTAGGED_READY).catch(() => null);
            if (nowReady === '1') return true;
        }
        return false;
    }

    try {
        await client.del(INDEX_KEYS.UNTAGGED);
        const total = (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
        const CHUNK = 500;
        for (let offset = 0; offset < total; offset += CHUNK) {
            const idsWithScores = await client.zrevrange(KEYS.CANDIDATES_LIST, offset, offset + CHUNK - 1, 'WITHSCORES');
            if (!idsWithScores?.length) break;
            const entries = [];
            for (let i = 0; i < idsWithScores.length; i += 2) {
                entries.push({ id: idsWithScores[i], score: Number(idsWithScores[i + 1] || 0) });
            }
            const readPipe = client.pipeline();
            entries.forEach(({ id }) => readPipe.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
            const rows = await readPipe.exec();
            const writePipe = client.pipeline();
            rows.forEach(([err, raw], index) => {
                if (err || !raw) return;
                try {
                    const c = JSON.parse(raw);
                    if (c?.id && cleanTagValues(c.tags).length === 0) {
                        writePipe.zadd(INDEX_KEYS.UNTAGGED, entries[index].score || candidateSortScore(c), c.id);
                    }
                } catch {}
            });
            await writePipe.exec();
            await new Promise(r => setTimeout(r, 2));
        }
        await client.set(INDEX_KEYS.UNTAGGED_READY, '1');
        return true;
    } finally {
        await client.del(INDEX_KEYS.UNTAGGED_LOCK).catch(() => {});
    }
}

export async function ensureCandidateSecondaryIndexes() {
    const client = getRedisClient();
    if (!client) return false;
    const ready = await client.get(INDEX_KEYS.READY).catch(() => null);
    if (ready === '1') return true;

    const locked = await client.set(INDEX_KEYS.LOCK, '1', 'EX', 300, 'NX').catch(() => null);
    if (!locked) {
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 250));
            const nowReady = await client.get(INDEX_KEYS.READY).catch(() => null);
            if (nowReady === '1') return true;
        }
        return false;
    }

    try {
        const total = (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
        const CHUNK = 500;
        for (let offset = 0; offset < total; offset += CHUNK) {
            const ids = await client.zrevrange(KEYS.CANDIDATES_LIST, offset, offset + CHUNK - 1);
            if (!ids?.length) break;
            const readPipe = client.pipeline();
            ids.forEach(id => readPipe.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
            const rows = await readPipe.exec();
            const writePipe = client.pipeline();
            for (const [err, raw] of rows) {
                if (err || !raw) continue;
                let c;
                try { c = JSON.parse(raw); } catch { continue; }
                if (!c?.id) continue;
                const tags = cleanTagValues(c.tags);
                tags.forEach(tag => writePipe.sadd(tagIndexKey(tag), c.id));
                if (tags.length === 0) writePipe.zadd(INDEX_KEYS.UNTAGGED, candidateSortScore(c), c.id);
                if (c.adId) writePipe.sadd(adIndexKey(c.adId), c.id);
            }
            await writePipe.exec();
            await new Promise(r => setTimeout(r, 2));
        }
        await client.set(INDEX_KEYS.READY, '1');
        await client.set(INDEX_KEYS.UNTAGGED_READY, '1');
        return true;
    } finally {
        await client.del(INDEX_KEYS.LOCK).catch(() => {});
    }
}

export async function hydrateCandidateIds(ids, limit = 500) {
    const client = getRedisClient();
    if (!client || !Array.isArray(ids) || ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)].slice(0, limit);
    const pipe = client.pipeline();
    uniqueIds.forEach(id => pipe.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
    const rows = await pipe.exec();
    return rows
        .map(([err, raw]) => {
            if (err || !raw) return null;
            try { return normalizeCandidateSilence(JSON.parse(raw)); } catch { return null; }
        })
        .filter(Boolean);
}

async function getManualProjectCandidateLinks(client, manualProjectId, manualStepId = '') {
    const projectId = String(manualProjectId || '').trim();
    const stepId = String(manualStepId || '').trim();
    if (!client || !projectId) return [];

    const linksRaw = await client.get(`${MANUAL_PROJECT_LINKS_PREFIX}${projectId}`).catch(() => null);
    let links = [];
    try {
        links = linksRaw ? JSON.parse(linksRaw) : [];
    } catch {
        links = [];
    }
    if (!Array.isArray(links)) return [];

    return links
        .map(link => ({
            candidateId: String(link?.candidateId || '').trim(),
            stepId: String(link?.stepId || '').trim(),
            linkedAt: link?.linkedAt || null
        }))
        .filter(link => link.candidateId && (!stepId || link.stepId === stepId));
}

async function getManualProjectCandidateIds(client, manualProjectId) {
    const projectId = String(manualProjectId || '').trim();
    if (!client || !projectId) return [];

    const indexed = await ensureCandidateManualIndexes();
    if (indexed) {
        const indexedIds = await client.smembers(manualProjectIndexKey(projectId));
        if (indexedIds?.length) return indexedIds;
    }

    const total = (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
    const ids = [];
    const CHUNK_SIZE = 500;
    for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
        const pageIds = await client.zrevrange(KEYS.CANDIDATES_LIST, offset, offset + CHUNK_SIZE - 1);
        if (!pageIds?.length) break;
        const pipe = client.pipeline();
        pageIds.forEach(id => pipe.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
        const rows = await pipe.exec();
        rows.forEach(([err, raw]) => {
            if (err || !raw) return;
            try {
                const c = JSON.parse(raw);
                if (String(c?.manualProjectId || '').trim() === projectId) ids.push(c.id);
            } catch {}
        });
        await new Promise(r => setTimeout(r, 2));
    }
    return ids;
}

export async function getCandidatesByAdIds(adIds = [], limit = 500) {
    const client = getRedisClient();
    if (!client || !Array.isArray(adIds) || adIds.length === 0) return [];
    await ensureCandidateSecondaryIndexes();
    const pipe = client.pipeline();
    adIds.map(String).filter(Boolean).forEach(adId => pipe.smembers(adIndexKey(adId)));
    const rows = await pipe.exec();
    const ids = rows.flatMap(([err, members]) => err || !members ? [] : members);
    return hydrateCandidateIds(ids, limit);
}

export async function getCandidatesByTag(tag, limit = 1000) {
    const client = getRedisClient();
    if (!client || !tag) return [];
    await ensureCandidateSecondaryIndexes();
    const ids = await client.smembers(tagIndexKey(tag));
    return hydrateCandidateIds(ids, limit);
}

// Para el nodo "inicio_lista" de Flujos (flujo manual, no en vivo — ver flow-engine.js):
// arma la lista de candidatos que matchean completo/incompleto/todos + al menos una de
// las etiquetas (OR) + opcionalmente "dentro de la ventana de 24h de Meta" ahora mismo.
// La ventana de 24h usa lastUserMessageAt (SOLO se actualiza con mensajes ENTRANTES del
// candidato — webhook.js/messenger webhook.js/saveMessage con isFromUser — nunca con
// salientes del bot/reclutador), igual que la detección reactiva de isMeta24hWindowError.
export async function getCandidatesForFlowList({ profileFilter = 'todos', tags = [], within24h = false } = {}, limit = 300) {
    const client = getRedisClient();
    if (!client) return { candidates: [], total: 0 };

    const cleanTags = cleanTagValues(tags);
    let baseIds;
    if (cleanTags.length) {
        await ensureCandidateSecondaryIndexes();
        const pipe = client.pipeline();
        cleanTags.forEach(tag => pipe.smembers(tagIndexKey(tag)));
        const rows = await pipe.exec();
        baseIds = [...new Set(rows.flatMap(([err, members]) => (err || !members) ? [] : members))];
    } else if (profileFilter === 'completo') {
        baseIds = await client.smembers(KEYS.LIST_COMPLETE);
    } else if (profileFilter === 'incompleto') {
        baseIds = await client.smembers(KEYS.LIST_PENDING);
    } else {
        const [c, p] = await Promise.all([client.smembers(KEYS.LIST_COMPLETE), client.smembers(KEYS.LIST_PENDING)]);
        baseIds = [...new Set([...c, ...p])];
    }
    if (!baseIds.length) return { candidates: [], total: 0 };

    // Se hidratan TODOS los ids de baseIds, sin cap intermedio — un cap aquí (ej. el
    // default 500 de hydrateCandidateIds) recortaría el set ANTES de aplicar tags/24h,
    // descartando en silencio candidatos que sí matchean (bug real detectado probando
    // contra Redis: con "todos" el cap cortaba justo donde termina LIST_COMPLETE y
    // LIST_PENDING casi desaparecía de los resultados). El único límite real es `limit`,
    // aplicado al final tras filtrar y ordenar.
    let candidates = await hydrateCandidateIds(baseIds, baseIds.length);

    if (cleanTags.length && profileFilter !== 'todos') {
        candidates = candidates.filter(c => profileFilter === 'completo' ? isProfileComplete(c) : !isProfileComplete(c));
    }
    if (within24h) {
        const now = Date.now();
        candidates = candidates.filter(c => {
            const t = new Date(c.lastUserMessageAt || 0).getTime();
            return Number.isFinite(t) && t > 0 && (now - t) < 24 * 60 * 60 * 1000;
        });
    }

    candidates.sort((a, b) =>
        new Date(b.lastUserMessageAt || b.ultimoMensaje || 0).getTime() - new Date(a.lastUserMessageAt || a.ultimoMensaje || 0).getTime()
    );

    return {
        total: candidates.length,
        candidates: candidates.slice(0, limit).map(c => ({
            id: c.id,
            nombre: c.nombreReal || c.nombre || c.whatsapp,
            whatsapp: c.whatsapp
        }))
    };
}

export const DEFAULT_PROJECT_STEPS = [
    { id: 'step_new', name: 'Nuevos' },
    { id: 'step_contact', name: 'Contacto' },
    { id: 'step_interview', name: 'Entrevista' },
    { id: 'step_hired', name: 'Contratado' }
];

export const getActiveBypassRules = async () => {
    const client = getClient();
    if (!client) return [];
    try {
        const ids = await client.zrange(KEYS.BYPASS_LIST, 0, -1);
        if (!ids || ids.length === 0) return [];

        const rulesRaw = await client.mget(ids.map(id => `${KEYS.BYPASS_PREFIX}${id}`));
        return rulesRaw
            .filter(r => r !== null)
            .map(r => {
                try { return JSON.parse(r) } catch (e) { return null }
            })
            .filter(r => r !== null && r.active === true);
    } catch (e) {
        console.error('Error fetching bypass rules:', e);
        return [];
    }
};


/**
 * ==========================================
 * GENERIC HELPERS 
 * ==========================================
 */
const _getDistributedItems = async (listKey, itemPrefixPrefix, start = 0, stop = -1) => {
    const client = getClient();
    if (!client) return [];

    try {
        // start/stop are 0-based Redis indices. 0, -1 means ALL.
        const ids = await client.zrevrange(listKey, start, stop);
        if (!ids || ids.length === 0) return [];

        const pipeline = client.pipeline();
        ids.forEach(id => {
            pipeline.get(`${itemPrefixPrefix}${id}`);
        });

        const results = await pipeline.exec();

        const items = results
            .map(([err, res]) => {
                if (err || !res) return null;
                try { return normalizeCandidateSilence(JSON.parse(res)); } catch { return null; }
            })
            .filter(i => i !== null);

        return items;
    } catch (e) {
        console.error(`Error fetching distributed items (${listKey}):`, e);
        return [];
    }
};

const saveDistributedItem = async (listKey, itemPrefix, item, id, customScore = null) => {
    const client = getClient();
    if (!client) return item;

    try {
        const key = `${itemPrefix}${id}`;
        await client.set(key, JSON.stringify(item));
        const score = customScore || Date.now();
        await client.zadd(listKey, score, id);
        return item;
    } catch (e) {
        console.error(`Error saving distributed item (${id}):`, e);
        throw e;
    }
};

/**
 * ==========================================
 * VACANCY INTERACTION HISTORY
 * ==========================================
 * Records actions like SHOWN, ACCEPTED, REJECTED for candidates.
 */
export const recordVacancyInteraction = async (candidateId, projectId, vacancyId, action, reason = null) => {
    const client = getClient();
    if (!client || !candidateId || !vacancyId) return;

    try {
        const historyKey = `vacancy_history:${candidateId}`;
        const event = {
            id: `interaction_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString(),
            projectId,
            vacancyId,
            action: action.toUpperCase(), // 'SHOWN', 'ACCEPTED', 'REJECTED'
            reason: reason || null
        };
        // Use a Sorted Set scored by timestamp to keep history ordered and fast to query
        await client.zadd(historyKey, Date.now(), JSON.stringify(event));
        // TTL: 90 days — interaction history is transient, not permanent business data
        await client.expire(historyKey, 90 * 24 * 3600);
        // 🛡️ OOM PREVENTION: Keep only last 100 interactions per candidate
        const count = await client.zcard(historyKey);
        if (count > 100) {
            await client.zremrangebyrank(historyKey, 0, count - 101);
        }
    } catch (e) {
        console.error(`[Storage] Error recording vacancy interaction for ${candidateId}:`, e);
    }
};

export const getVacancyHistory = async (candidateId) => {
    const client = getClient();
    if (!client || !candidateId) return [];

    try {
        const historyKey = `vacancy_history:${candidateId}`;
        // Fetch all interactions, oldest to newest
        const rawItems = await client.zrange(historyKey, 0, -1);
        return rawItems.map(item => JSON.parse(item)).reverse(); // Reverse for newest first
    } catch (e) {
        console.error(`[Storage] Error fetching vacancy history for ${candidateId}:`, e);
        return [];
    }
};

const deleteDistributedItem = async (listKey, itemPrefix, id) => {
    const client = getClient();
    if (!client) return false;

    try {
        const key = `${itemPrefix}${id}`;
        await client.del(key);
        await client.zrem(listKey, id);
        return true;
    } catch (e) {
        console.error(`Error deleting distributed item (${id}):`, e);
        return false;
    }
};

/**
 * ==========================================
 * AUTH TOKENS (PINs)
 * ==========================================
 */
export const saveAuthToken = async (phone, pin) => {
    const client = getClient();
    if (!client) return false;
    // Set with expiry (15 mins — gives user enough time to switch apps)
    await client.set(`${KEYS.AUTH_PREFIX}${phone}`, pin, 'EX', 900);
    return true;
};

export const getAuthToken = async (phone) => {
    const client = getClient();
    if (!client) return null;
    return await client.get(`${KEYS.AUTH_PREFIX}${phone}`);
};

export const deleteAuthToken = async (phone) => {
    const client = getClient();
    if (!client) return;
    await client.del(`${KEYS.AUTH_PREFIX}${phone}`);
};


/**
 * ==========================================
 * CANDIDATES (Distributed)
 * ==========================================
 */
// --- 🛡️ Quality Shield: Iron-Clad Completion Check ---

/**
 * Standard Fields that define a "Complete" profile.
 * Synchronized across the entire platform.
 */
export const CORE_REQUIRED_FIELDS = [
    { value: 'nombreReal', label: 'Nombre completo', invalidValue: 'proporcionado' },
    { value: 'genero', label: 'Género', invalidValue: 'desconocido' },
    { value: 'fechaNacimiento', label: 'Fecha de Nacimiento', invalidValue: 'proporcionada' },
    { value: 'municipio', label: 'Municipio', invalidValue: 'proporcionado' },
    { value: 'categoria', label: 'Categoría', invalidValue: 'proporcionas' },
    { value: 'escolaridad', label: 'Escolaridad', invalidValue: 'proporcionado' }
];

/**
 * Unified Auditor: The single source of truth for profile completion.
 * @returns {Object} { isComplete, missingLabels, missingValues, dnaLines, paso1Status }
 */
export const auditProfile = (c, customFields = []) => {
    if (!c) return { isComplete: false, missingLabels: [], missingValues: [], dnaLines: '', paso1Status: 'INCOMPLETO' };

    const missingLabels = [];
    const missingValues = [];
    const dnaLinesArray = [];

    // 1. Audit Core Fields
    for (const field of CORE_REQUIRED_FIELDS) {
        const rawVal = c[field.value];
        const val = String(rawVal || '').toLowerCase().trim();

        let isInvalid = !rawVal ||
            val.includes(field.invalidValue) ||
            val.includes('proporcionado') ||
            val === 'desconocido' ||
            val === 'consulta general' ||
            val === 'general' ||
            val === 'n/a' ||
            val === 'na' ||
            val === 'null' ||
            val === 'ninguno' ||
            val === 'ninguna' ||
            val === 'none' ||
            val.length < 2 ||
            val.includes('luego') ||
            val.includes('después') ||
            val.includes('no lo se') ||
            val.includes('no se') ||
            val.includes('para que') ||
            val.includes('porque quieres') ||
            val.includes('no te') ||
            val.includes('privado') ||
            val === 'hola' ||
            val === 'buenas' ||
            val === 'buenos dias' ||
            val === 'buenas tardes' ||
            val === 'buenas noches' ||
            val === 'qué tal' ||
            val === 'que tal' ||
            val === 'lista' ||
            val === 'listo' ||
            // --- JUNK DATA BLOCK (Adjectives/Vague praise) ---
            val === 'bien' || val === 'super' || val === 'súper' || val === 'super bien' || val === 'superbien' ||
            val === 'ok' || val === 'claro' || val === 'porsupuesto' || val === 'por supuesto' ||
            val === 'perfecto' || val === 'excelente' || val === 'genial' || val === 'todo bien' ||
            val === 'todos' || val === 'alguno' || val === 'algunos' || val === 'cualquiera';

        // Strict Enforcements
        if (field.value === 'nombreReal' && !isInvalid) {
            const wordCount = val.split(/\s+/).filter(w => w.length > 0).length;
            if (wordCount < 2) isInvalid = true;
        }

        // --- DATE PRECISION (DD/MM/YYYY) ---
        if (field.value === 'fechaNacimiento' && !isInvalid) {
            const dateRegex = /^(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[012])\/\d{4}$/;
            if (!dateRegex.test(val)) {
                isInvalid = true;
            } else {
                // Reasonable Age Check (1900 - Current Year)
                const yearMatch = val.match(/\b(19|20)\d{2}\b/);
                if (yearMatch) {
                    const yearValue = parseInt(yearMatch[0]);
                    const currentYear = new Date().getFullYear();
                    if (yearValue < 1900 || yearValue > currentYear) isInvalid = true;
                }
            }
        }

        // --- SCHOOLING PRECISION (Requires at least Primaria) ---
        if (field.value === 'escolaridad' && !isInvalid) {
            const junkEducation = ['kinder', 'ninguno', 'ninguna', 'sin estudios', 'no tengo', 'no curse', 'preescolar', 'maternal'];
            if (junkEducation.some(e => val.includes(e))) isInvalid = true;
        }

        if (isInvalid) {
            const label = (field.value === 'nombreReal' && val.length >= 2) ? "Apellidos" : field.label;
            missingLabels.push(label);
            missingValues.push(field.value);
        }

        dnaLinesArray.push(`- ${field.label}: ${rawVal || 'No proporcionado'}`);
    }

    // 2. Audit Custom Fields
    if (customFields && customFields.length > 0) {
        for (const cf of customFields) {
            // Prevent duplicating fields that are already in CORE_REQUIRED_FIELDS
            if (CORE_REQUIRED_FIELDS.some(core => core.value === cf.value)) continue;

            const rawVal = c[cf.value];
            const val = String(rawVal || '').toLowerCase().trim();
            const isInvalid = !rawVal || val.includes('proporcionado');

            if (isInvalid) {
                missingLabels.push(cf.label || cf.value);
                missingValues.push(cf.value);
            }
            dnaLinesArray.push(`- ${cf.label || cf.value}: ${rawVal || 'No proporcionado'}`);
        }
    }

    const isComplete = missingValues.length === 0;

    return {
        isComplete,
        missingLabels,
        missingValues,
        dnaLines: dnaLinesArray.join('\n'),
        paso1Status: isComplete ? 'COMPLETO' : 'INCOMPLETO'
    };
};

export const isProfileComplete = (c, customFields = []) => {
    const { isComplete } = auditProfile(c, customFields);
    if (!isComplete) return false;
    // Completo = paso 1 (datos) + paso 2 completo
    return c.paso2Estado === 'completo';
};

// Native Redis Pagination (Page size 100)
export const getCandidates = async (limit = 100, offset = 0, search = '', excludeLinked = false, tagFilter = '', manualProjectId = '', manualStepId = '', statusFilter = '') => {
    const client = getClient();
    if (!client) return { candidates: [], total: 0 };

    // ✅ META AUDIT: Removed O(N) HKEYS call for CANDIDATE_PROJECT_LINK hydration.
    // The 'proyecto' virtual field is now derived from the candidate's own projectId field.

    if (manualProjectId && !excludeLinked) {
        const stepId = String(manualStepId || '').trim();
        const matchingLinks = stepId ? await getManualProjectCandidateLinks(client, manualProjectId, stepId) : [];
        const matchingIds = stepId
            ? matchingLinks.map(link => link.candidateId)
            : await getManualProjectCandidateIds(client, manualProjectId);
        if (!matchingIds.length) return { candidates: [], total: 0 };
        const linkById = new Map(matchingLinks.map(link => [link.candidateId, link]));

        let scoreRows = [];
        try {
            scoreRows = await client.zmscore(KEYS.CANDIDATES_LIST, ...matchingIds);
        } catch {
            const scorePipe = client.pipeline();
            matchingIds.forEach(id => scorePipe.zscore(KEYS.CANDIDATES_LIST, id));
            scoreRows = (await scorePipe.exec()).map(([err, score]) => err ? null : score);
        }

        const orderedIds = matchingIds
            .map((id, index) => ({ id, score: Number(scoreRows?.[index] || 0) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.id);

        const hydrated = (await hydrateCandidateIds(orderedIds, orderedIds.length)).map(candidate => {
            const link = linkById.get(String(candidate.id));
            if (!link) return candidate;
            return {
                ...candidate,
                manualProjectId,
                manualProjectStepId: link.stepId || candidate.manualProjectStepId,
                crmMeta: {
                    ...(candidate.crmMeta || {}),
                    stepId: link.stepId || candidate.manualProjectStepId || '',
                    linkedAt: link.linkedAt || candidate.crmMeta?.linkedAt || candidate.primerContacto
                }
            };
        });
        const lowerSearch = search.toLowerCase();
        const cleanSearch = search.replace(/\D/g, '');
        const normalizedTagFilter = String(tagFilter || '').trim().toLowerCase();
        const projectId = String(manualProjectId || '').trim();
        const normalizedStatusFilter = String(statusFilter || '').trim().toLowerCase();
        const needsProfileAudit = normalizedStatusFilter === 'complete' || normalizedStatusFilter === 'incomplete';
        const customFieldsRaw = needsProfileAudit ? await getCachedConfig(client, 'custom_fields') : null;
        const customFields = customFieldsRaw ? JSON.parse(customFieldsRaw) : [];
        const filtered = hydrated.filter(c => {
            if (String(c?.manualProjectId || '').trim() !== projectId) return false;
            if (stepId && String(c?.manualProjectStepId || '').trim() !== stepId) return false;

            if (normalizedStatusFilter === 'unread') {
                const userTs = c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;
                const humanTs = c.lastHumanMessageAt ? new Date(c.lastHumanMessageAt).getTime() : 0;
                if (!userTs || userTs <= humanTs) return false;
            } else if (normalizedStatusFilter === 'complete') {
                if (!isProfileComplete(c, customFields)) return false;
            } else if (normalizedStatusFilter === 'incomplete') {
                if (isProfileComplete(c, customFields)) return false;
            }

            if (normalizedTagFilter) {
                const candidateTags = cleanTagValues(c.tags);
                if (normalizedTagFilter === UNTAGGED_TAG_FILTER) {
                    if (candidateTags.length > 0) return false;
                } else if (!candidateTags.some(t => t.toLowerCase() === normalizedTagFilter)) {
                    return false;
                }
            }

            if (search) {
                const foundInFields = Object.values(c).some(val =>
                    val !== null && val !== undefined && val.toString().toLowerCase().includes(lowerSearch)
                );
                if (foundInFields) return true;
                if (cleanSearch && c.whatsapp) {
                    return c.whatsapp.replace(/\D/g, '').includes(cleanSearch);
                }
                return false;
            }

            return true;
        });

        return {
            candidates: filtered.slice(offset, offset + limit),
            total: filtered.length
        };
    }

    // Plain list and indexed tag filters avoid streaming whole candidate payloads.
    if (!search && !tagFilter && !excludeLinked) {
        const sumCount = async () => (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
        const stop = offset + limit - 1;
        const ids = await client.zrevrange(KEYS.CANDIDATES_LIST, offset, stop);
        if (!ids || ids.length === 0) return { candidates: [], total: await sumCount() };

        // Optimized Pipeline Loading
        const pipeline = client.pipeline();
        ids.forEach(id => pipeline.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
        const results = await pipeline.exec();

        const candidates = results
            .map(([err, res]) => (err || !res) ? null : normalizeCandidateSilence(JSON.parse(res)))
            .filter(Boolean);

        const total = await sumCount();
        return { candidates, total };
    }

    if (!search && tagFilter && tagFilter.trim().toLowerCase() === UNTAGGED_TAG_FILTER && !excludeLinked) {
        const indexed = await ensureCandidateUntaggedIndex();
        if (indexed) {
            const total = await client.zcard(INDEX_KEYS.UNTAGGED);
            const ids = await client.zrevrange(INDEX_KEYS.UNTAGGED, offset, offset + limit - 1);
            return {
                candidates: await hydrateCandidateIds(ids, ids.length),
                total
            };
        }
    }

    if (!search && tagFilter && tagFilter.trim().toLowerCase() !== UNTAGGED_TAG_FILTER && !excludeLinked) {
        await ensureCandidateSecondaryIndexes();
        const indexedIds = await client.smembers(tagIndexKey(tagFilter));
        if (!indexedIds?.length) return { candidates: [], total: 0 };

        let scoreRows = [];
        try {
            scoreRows = await client.zmscore(KEYS.CANDIDATES_LIST, ...indexedIds);
        } catch {
            const scorePipe = client.pipeline();
            indexedIds.forEach(id => scorePipe.zscore(KEYS.CANDIDATES_LIST, id));
            scoreRows = (await scorePipe.exec()).map(([err, score]) => err ? null : score);
        }
        const orderedIds = indexedIds
            .map((id, index) => ({ id, score: Number(scoreRows?.[index] || 0) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.id);
        const pageIds = orderedIds.slice(offset, offset + limit);
        return {
            candidates: await hydrateCandidateIds(pageIds, pageIds.length),
            total: orderedIds.length
        };
    }

    // SEARCH PATH or EXCLUSION PATH
    // Optimization: Stream candidates from Redis in chunks to prevent Node.js OOM crashes on large databases.
    const lowerSearch = search.toLowerCase();
    const cleanSearch = search.replace(/\D/g, '');

    const customFieldsJson = excludeLinked ? await getCachedConfig(client, 'custom_fields') : null;
    const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

    const totalDbCount = async () => (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
    const dbSize = await totalDbCount();

    let filtered = [];
    const CHUNK_SIZE = 500;
    let currentIndex = 0;

    // We stop when we have found enough items to fill the current page (offset + limit)
    // OR we have scanned the entire database.
    while (currentIndex < dbSize && filtered.length < offset + limit) {
        const ids = await client.zrevrange(KEYS.CANDIDATES_LIST, currentIndex, currentIndex + CHUNK_SIZE - 1);
        if (!ids || ids.length === 0) break;
        
        const pipeline = client.pipeline();
        ids.forEach(id => pipeline.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
        const results = await pipeline.exec();
        
        for (let i = 0; i < results.length; i++) {
            const [err, res] = results[i];
            if (err || !res) continue;
            
            try {
                const c = normalizeCandidateSilence(JSON.parse(res));
                
                // Special tag value used by Chat Web to page candidates with no labels.
                if (tagFilter) {
                    const candidateTags = cleanTagValues(c.tags);
                    const normalizedTagFilter = tagFilter.trim().toLowerCase();
                    if (normalizedTagFilter === UNTAGGED_TAG_FILTER) {
                        if (candidateTags.length > 0) continue;
                    } else if (!candidateTags.some(t => t.toLowerCase() === normalizedTagFilter)) {
                        continue;
                    }
                }
                
                // 2. Exclusion Filter (Linked profiles or incomplete profiles)
                // ✅ META AUDIT: Check projectId inline instead of external hash lookup
                if (excludeLinked) {
                    const isLinked = !!c.projectId;
                    if (isLinked || !isProfileComplete(c, customFields)) continue;
                }
                
                // 3. Search Filter
                if (search) {
                    let match = false;
                    const foundInFields = Object.values(c).some(val =>
                        val !== null && val !== undefined && val.toString().toLowerCase().includes(lowerSearch)
                    );
                    if (foundInFields) match = true;
                    else if (cleanSearch && c.whatsapp) {
                        const cleanWhatsApp = c.whatsapp.replace(/\D/g, '');
                        if (cleanWhatsApp.includes(cleanSearch)) match = true;
                    }
                    if (!match) continue;
                }
                
                // Passed all active filters
                filtered.push(c);
                
            } catch (e) {
                // Ignore parse errors
            }
        }
        
        currentIndex += CHUNK_SIZE;
        // Yield event loop
        await new Promise(r => setTimeout(r, 2));
    }

    const isExhausted = currentIndex >= dbSize;
    // Provide a fake total to allow pagination "Next" button if not exhausted
    const estimatedTotal = isExhausted ? filtered.length : filtered.length + 1;

    return {
        candidates: filtered.slice(offset, offset + limit),
        total: estimatedTotal
    };
};

/**
 * Siembra candidates:unread escaneando todos los candidatos donde lastUserMessageAt > lastHumanMessageAt.
 * Se llama una sola vez en background cuando el Set está vacío (primer deploy).
 */
async function _seedUnreadSet(client) {
    try {
        const dbSize = (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
        let index = 0;
        const CHUNK = 500;
        let totalUnread = 0;
        while (index < dbSize) {
            const ids = await client.zrevrange(KEYS.CANDIDATES_LIST, index, index + CHUNK - 1);
            if (!ids || ids.length === 0) break;
            const pipeline = client.pipeline();
            ids.forEach(id => pipeline.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
            const results = await pipeline.exec();
            const unreadIds = [];
            for (const [err, res] of results) {
                if (err || !res) continue;
                try {
                    const c = normalizeCandidateSilence(JSON.parse(res));
                    const ut = c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;
                    const ht = c.lastHumanMessageAt ? new Date(c.lastHumanMessageAt).getTime() : 0;
                    if (ut > ht) unreadIds.push(c.id);
                } catch {}
            }
            if (unreadIds.length > 0) {
                await client.sadd(KEYS.CANDIDATES_UNREAD, ...unreadIds);
                totalUnread += unreadIds.length;
            }
            index += CHUNK;
            await new Promise(r => setTimeout(r, 5));
        }
        await client.set('stats:bot:unread_v2', totalUnread);
        await client.incr('stats:unread:version').catch(() => {});
        console.log(`✅ [candidates:unread] Set sembrado: ${totalUnread} no leídos`);
    } catch (err) {
        console.error('❌ [candidates:unread] Siembra fallida:', err);
    }
}

/**
 * Carga todos los candidatos no-leídos (desde el Set candidates:unread)
 * más los `recentLimit` más recientes que no estén ya en esa lista.
 * O(1) para el Set + O(recentLimit) pipeline GET. Sin SCAN.
 * Si el Set está vacío (primer deploy), siembra en background y devuelve fallback.
 */
export const getCandidatesUnreadFirst = async (recentLimit = 50, offset = 0) => {
    const client = getClient();
    if (!client) return { candidates: [], total: 0 };

    const setSize = await client.scard(KEYS.CANDIDATES_UNREAD);

    // Set vacío = primer deploy: sembrar en fondo y devolver fallback mientras tanto
    if (setSize === 0) {
        _seedUnreadSet(client); // fire-and-forget
        const fallbackIds = await client.zrevrange(KEYS.CANDIDATES_LIST, 0, 299);
        if (!fallbackIds.length) return { candidates: [], total: 0 };
        const fp = client.pipeline();
        fallbackIds.forEach(id => fp.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
        const fr = await fp.exec();
        const candidates = fr.map(([e, r]) => e || !r ? null : normalizeCandidateSilence(JSON.parse(r))).filter(Boolean);
        return { candidates, total: candidates.length };
    }

    // Todos los IDs no-leídos del Set (O(1))
    const unreadIds = await client.smembers(KEYS.CANDIDATES_UNREAD);

    // Los recientes cubren la ventana solicitada para permitir paginación sin recargar cientos.
    const recentIds = await client.zrevrange(KEYS.CANDIDATES_LIST, 0, offset + recentLimit - 1);

    // Unión sin duplicados: no-leídos primero, luego recientes no repetidos
    const unreadSet = new Set(unreadIds);
    const recentOnly = recentIds.filter(id => !unreadSet.has(id));
    const allIds = [...unreadIds, ...recentOnly];

    if (allIds.length === 0) return { candidates: [], total: 0 };

    const pipeline = client.pipeline();
    allIds.forEach(id => pipeline.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
    const results = await pipeline.exec();

    const candidates = results
        .map(([err, res]) => (err || !res) ? null : normalizeCandidateSilence(JSON.parse(res)))
        .filter(Boolean);

    candidates.sort((a, b) =>
        new Date(b.lastUserMessageAt || b.ultimoMensaje || 0).getTime() -
        new Date(a.lastUserMessageAt || a.ultimoMensaje || 0).getTime()
    );

    return { candidates: candidates.slice(offset, offset + recentLimit), total: candidates.length };
};

// Filtro servidor: 'unread' | 'complete' | 'incomplete' — escanea candidates:unread y filtra
export const getCandidatesFiltered = async (filter, limit = 500, offset = 0) => {
    const client = getClient();
    if (!client) return { candidates: [], total: 0 };

    const unreadIds = await client.smembers(KEYS.CANDIDATES_UNREAD);
    if (!unreadIds.length) return { candidates: [], total: 0 };

    if (filter === 'unread') {
        let scoreRows = [];
        try {
            scoreRows = await client.zmscore(KEYS.CANDIDATES_LIST, ...unreadIds);
        } catch {
            const scorePipe = client.pipeline();
            unreadIds.forEach(id => scorePipe.zscore(KEYS.CANDIDATES_LIST, id));
            scoreRows = (await scorePipe.exec()).map(([err, score]) => err ? null : score);
        }

        const orderedIds = unreadIds
            .map((id, index) => ({ id, score: Number(scoreRows?.[index] || 0) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.id);

        const pageIds = orderedIds.slice(offset, offset + limit);
        return {
            candidates: await hydrateCandidateIds(pageIds, pageIds.length),
            total: orderedIds.length
        };
    }

    const customFieldsRaw = await getCachedConfig(client, 'custom_fields');
    const customFields = customFieldsRaw ? JSON.parse(customFieldsRaw) : [];

    const pipe = client.pipeline();
    unreadIds.forEach(id => pipe.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
    const results = await pipe.exec();

    const candidates = results
        .map(([err, res]) => (err || !res) ? null : normalizeCandidateSilence(JSON.parse(res)))
        .filter(c => {
            if (!c) return false;
            const u = new Date(c.lastUserMessageAt || 0).getTime();
            const h = new Date(c.lastHumanMessageAt || 0).getTime();
            if (!u || u <= h) return false; // no es realmente no-leído
            if (filter === 'complete') return isProfileComplete(c, customFields);
            if (filter === 'incomplete') return !isProfileComplete(c, customFields);
            return true; // 'unread' = todos los no-leídos
        });

    // Ordenar por último mensaje DESC
    candidates.sort((a, b) =>
        new Date(b.lastUserMessageAt || 0).getTime() - new Date(a.lastUserMessageAt || 0).getTime()
    );

    const total = candidates.length;
    return { candidates: candidates.slice(offset, offset + limit), total };
};

// Unread-first pero filtrado por etiqueta — para la primera página con tag activo
export const getCandidatesUnreadFirstByTag = async (tagFilter, limit = 33, offset = 0, statusFilter = '', unreadOnly = false) => {
    const client = getClient();
    if (!client) return { candidates: [], total: 0 };

    const tagLower = tagFilter.trim().toLowerCase();
    const unreadIds = await client.smembers(KEYS.CANDIDATES_UNREAD);
    const unreadSet = new Set(unreadIds);
    let matchingWithScores = [];

    if (tagLower === UNTAGGED_TAG_FILTER) {
        const indexed = await ensureCandidateUntaggedIndex();
        if (!indexed) return { candidates: [], total: 0 };

        const idsWithScores = await client.zrevrange(INDEX_KEYS.UNTAGGED, 0, -1, 'WITHSCORES');
        for (let i = 0; i < idsWithScores.length; i += 2) {
            matchingWithScores.push({
                id: idsWithScores[i],
                score: Number(idsWithScores[i + 1] || 0)
            });
        }
    } else {
        await ensureCandidateSecondaryIndexes();
        const indexedIds = await client.smembers(tagIndexKey(tagFilter));
        if (!indexedIds?.length) return { candidates: [], total: 0 };

        let scoreRows = [];
        try {
            scoreRows = await client.zmscore(KEYS.CANDIDATES_LIST, ...indexedIds);
        } catch {
            const scorePipe = client.pipeline();
            indexedIds.forEach(id => scorePipe.zscore(KEYS.CANDIDATES_LIST, id));
            scoreRows = (await scorePipe.exec()).map(([err, score]) => err ? null : score);
        }

        matchingWithScores = indexedIds
            .map((id, index) => ({ id, score: Number(scoreRows?.[index] || 0) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score);
    }

    // 🏎️ Filtro de estado en servidor: intersecta con los MISMOS sets que ya usa
    // getCandidatesFiltered (stats:list:complete / candidates:unread) e hidrata solo
    // los que aplican. Antes, con tag + filtro activo, se hidrataba TODO el tag y el
    // navegador descartaba hasta el 98% (medido: KATCON 231 blobs para mostrar 4).
    // El frontend re-filtra lo recibido, asi que esto solo puede recortar, nunca
    // agregar de mas a la vista.
    if ((statusFilter === 'complete' || statusFilter === 'incomplete') && matchingWithScores.length) {
        try {
            const ids = matchingWithScores.map(m => m.id);
            const flags = await client.smismember(KEYS.LIST_COMPLETE, ...ids);
            matchingWithScores = matchingWithScores.filter((_, i) =>
                statusFilter === 'complete' ? flags[i] === 1 : flags[i] !== 1
            );
        } catch { /* sin smismember: no filtrar (superconjunto, el frontend recorta) */ }
    }
    if (statusFilter === 'unread' || unreadOnly) {
        matchingWithScores = matchingWithScores.filter(m => unreadSet.has(m.id));
    }

    const unread = [];
    const read = [];
    for (const item of matchingWithScores) {
        if (unreadSet.has(item.id)) unread.push(item);
        else read.push(item);
    }

    const matchingIds = [...unread, ...read].map(item => item.id);
    const pageIds = matchingIds.slice(offset, offset + limit);
    return {
        candidates: await hydrateCandidateIds(pageIds, pageIds.length),
        total: matchingIds.length
    };
};

const _publishGlobalStats = async (client) => {
    try {
        const p = client.pipeline();
        p.scard(KEYS.LIST_COMPLETE);
        p.scard(KEYS.LIST_PENDING);
        p.scard(KEYS.CANDIDATES_UNREAD);
        p.get(KEYS.STATS_INCOMING);
        p.get(KEYS.STATS_OUTGOING);
        const results = await p.exec();
        const complete  = results[0][1] || 0;
        const pending   = results[1][1] || 0;
        const unread    = parseInt(results[2][1]) || 0;
        const incoming  = parseInt(results[3][1]) || 0;
        const outgoing  = parseInt(results[4][1]) || 0;
        await client.publish('channel:sse:updates', JSON.stringify({
            type: 'stats:global',
            data: { total: complete + pending, complete, pending, unread, incoming, outgoing }
        }));
    } catch (_) {}
};

/**
 * [SIN TANTO ROLLO] Atomic Statistic Synchronizer
 * Moves candidate ID between 'complete' and 'pending' sets based on audit.
 * This makes global counting O(1) via SCARD.
 * @param {string} id - The candidate ID
 * @param {object} candidateData - Optional: The full candidate object (avoids extra GET)
 * @param {object} pipeline - Optional: A Redis pipeline to add commands to
 */
export const syncCandidateStats = async (id, candidateData = null, pipeline = null) => {
    const client = getRedisClient();
    if (!client) return;

    try {
        const c = candidateData || await getCandidateById(id);
        if (!c) {
            // If candidate doesn't exist, cleanup from sets
            if (pipeline) {
                pipeline.srem(KEYS.LIST_COMPLETE, id);
                pipeline.srem(KEYS.LIST_PENDING, id);
            } else {
                await client.multi()
                    .srem(KEYS.LIST_COMPLETE, id)
                    .srem(KEYS.LIST_PENDING, id)
                    .exec();
            }
            return;
        }

        // 1. Audit — must check paso2 too, not just paso1
        const customFieldsJson = await getCachedConfig(client, 'custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
        const isComplete = isProfileComplete(c, customFields);

        // 2. Denormalize status inside the object
        const isFirstSync = c.statusAudit == null;
        const wasIncomplete = c.statusAudit !== 'complete';
        c.statusAudit = isComplete ? 'complete' : 'pending';
        // Did completeness actually flip? (or never synced before) — used below to skip
        // the SADD/SREM dance on every message when nothing changed. Confirmado con
        // MONITOR: 108 escrituras a stats:list:pending/complete en solo 20 mensajes,
        // la gran mayoria sin ningun cambio real de estado.
        const statusChanged = isFirstSync || (wasIncomplete === isComplete);

        // 📊 Meta Conversions API — fire once when profile first becomes complete
        if (isComplete && wasIncomplete && c.adClickId) {
            sendConversionEvent({
                eventName: 'CompleteRegistration',
                phone: c.whatsapp,
                ctwaClid: c.adClickId,
                customData: {
                    ...(c.adId && { ad_id: c.adId }),
                    ...(c.adHeadline && { ad_title: c.adHeadline }),
                    ...(c.categoria && { vacancy: c.categoria }),
                    ...(c.municipio && { city: c.municipio }),
                }
            }).catch(() => {});
        }

        // 3. Update Sets Atomically — solo si el estado realmente cambio (o es la
        // primera vez que se sincroniza este candidato)
        if (statusChanged) {
            if (pipeline) {
                if (isComplete) {
                    pipeline.sadd(KEYS.LIST_COMPLETE, id);
                    pipeline.srem(KEYS.LIST_PENDING, id);
                } else {
                    pipeline.sadd(KEYS.LIST_PENDING, id);
                    pipeline.srem(KEYS.LIST_COMPLETE, id);
                }
            } else {
                if (isComplete) {
                    await client.multi()
                        .sadd(KEYS.LIST_COMPLETE, id)
                        .srem(KEYS.LIST_PENDING, id)
                        .exec();
                } else {
                    await client.multi()
                        .sadd(KEYS.LIST_PENDING, id)
                        .srem(KEYS.LIST_COMPLETE, id)
                        .exec();
                }
                _publishGlobalStats(client).catch(() => {});
            }
        }

        // 4. Return the enriched candidate for saving if it was passed in
        return c;
    } catch (e) {
        console.error(`❌ [Storage] syncCandidateStats Error for ${id}:`, e);
    }
};

export const saveCandidate = async (candidate) => {
    // 🛑 SIMULATOR SHIELD: Never save simulator mock candidates to the main database or indexes.
    if (candidate.id && String(candidate.id).startsWith('sim_')) {
        // We still need to save it temporarily so the agent can read its own history during the session.
        const client = getRedisClient();
        if (client) {
            await client.set(candidate.id, JSON.stringify(candidate), 'EX', 3600); // 1 hour TTL
        }
        return candidate;
    }

    if (!candidate.id) {
        candidate.id = `cand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 🛡️ CRITICAL FIELD GUARD: Protect fields that should never be erased once set.
    // If the incoming object is missing these fields but Redis already has them,
    // the Redis value wins — prevents any race condition from silently wiping them.
    const client = getRedisClient();

    // Track new candidates once, even if two webhooks race to create the same ID.
    let _isNewCandidate = false;
    if (client && candidate.id) {
        try {
            const candidateKey = `${KEYS.CANDIDATE_PREFIX}${candidate.id}`;
            const exists = await client.exists(candidateKey);
            if (!exists) {
                const marked = await client.set(`candidate:new:seen:${candidate.id}`, '1', 'NX');
                _isNewCandidate = marked === 'OK';
            }
        } catch {}
    }

    let previousCandidate = null;
    if (client && candidate.id && (!candidate.lastUserMessageAt || !candidate.primerContacto || !candidate.mensajesTotales)) {
        try {
            const existing = await client.get(`${KEYS.CANDIDATE_PREFIX}${candidate.id}`);
            if (existing) {
                const ex = JSON.parse(existing);
                previousCandidate = ex;
                if (!candidate.lastUserMessageAt && ex.lastUserMessageAt) candidate = { ...candidate, lastUserMessageAt: ex.lastUserMessageAt };
                if (!candidate.primerContacto && ex.primerContacto) candidate = { ...candidate, primerContacto: ex.primerContacto };
                if (!candidate.mensajesTotales && ex.mensajesTotales) candidate = { ...candidate, mensajesTotales: ex.mensajesTotales };
            }
        } catch { }
    }
    // Solo indexar en la creacion — el telefono no cambia despues, y updateCandidate()
    // llama saveCandidate() en cada mensaje, así que sin este guard se reescribia la
    // misma llave una y otra vez (confirmado con MONITOR: 22 HSET en una sola
    // conversacion con Brenda, todas para candidatos que ya existian).
    if (client && candidate.whatsapp && _isNewCandidate) {
        const cleanPhone = candidate.whatsapp.replace(/\D/g, '');
        // Store in centralized Hash for atomic O(1) lookups across all instances
        await client.hset(KEYS.PHONE_INDEX, cleanPhone, candidate.id).catch(() => { });
    }

    // [SIN TANTO ROLLO] Atomic Status Sync
    const enriched = await syncCandidateStats(candidate.id, candidate);
    const finalCandidate = enriched || candidate;

    // Sort by Last Message (Desc) or Creation Time
    const score = new Date(finalCandidate.ultimoMensaje || finalCandidate.primerContacto || Date.now()).getTime();
    const saved = await saveDistributedItem(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX, finalCandidate, finalCandidate.id, score);
    // Increment daily captures hash for new candidates after the candidate exists in storage.
    if (_isNewCandidate && client) {
        const rawDate = finalCandidate.createdAt || finalCandidate.primerContacto;
        if (rawDate) {
            try {
                const parsedDate = new Date(rawDate);
                const dateSource = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
                const dateKey = dateSource.toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
                await client.hincrby('stats:daily:captures', dateKey, 1);
                // Altas por ETIQUETA y día (para "cuántos de Yageo llegaron hoy"). Solo cuenta las
                // etiquetas presentes al CREARSE el candidato (las de anuncio ya vienen). Barato y
                // fire-and-forget: no bloquea la creación y no escanea nada.
                const capturedTags = cleanTagValues(finalCandidate.tags);
                if (capturedTags.length) {
                    const tp = client.pipeline();
                    capturedTags.forEach((t) => tp.hincrby(`stats:daily:captures:tag:${t}`, dateKey, 1));
                    tp.exec().catch(() => {});
                }
            } catch {}
        }
    }
    syncCandidateSecondaryIndexes(client, previousCandidate, finalCandidate).catch(() => {});
    if (_isNewCandidate && client && cleanTagValues(finalCandidate.tags).length === 0) {
        client.incr(UNTAGGED_COUNT_KEY).catch(() => {});
    }
    if (_isNewCandidate) {
        if (client) _publishGlobalStats(client).catch(() => {});
        import('./sse-notify.js').then(({ notifyNewCandidate }) => {
            notifyNewCandidate(saved).catch(() => {});
        }).catch(() => {});
    }
    return saved;
};

export const getCandidateByPhone = async (phone) => {
    const client = getRedisClient();
    if (!client || !phone) return null;

    let cleanPhone = phone.replace(/\D/g, '');

    // Try original
    try {
        let id = await client.hget(KEYS.PHONE_INDEX, cleanPhone);

        // If not found, try common Mexico prefix variations and raw 10 digits
        if (!id) {
            const last10 = cleanPhone.slice(-10);
            if (last10.length === 10) {
                // Match tries: 10 digits, 52+10, 521+10
                const variations = [last10, '52' + last10, '521' + last10];
                for (const v of variations) {
                    if (v === cleanPhone) continue; // Already tried
                    id = await client.hget(KEYS.PHONE_INDEX, v);
                    if (id) break;
                }
            }
        }

        if (!id) return null;
        return await getCandidateById(id);
    } catch (e) {
        console.error('❌ [Storage] getCandidateByPhone Error:', e);
        return null;
    }
};

export const deleteCandidate = async (id) => {
    const client = getRedisClient();
    if (client) {
        // 1. Fetch candidate first to get phone (needed to clean PHONE_INDEX)
        let phone = null;
        let wasUnread = false;
        try {
            const raw = await client.get(`${KEYS.CANDIDATE_PREFIX}${id}`);
            if (raw) {
                const c = JSON.parse(raw);
                phone = c.whatsapp ? c.whatsapp.replace(/\D/g, '') : null;
                const userTime = c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;
                const humanTime = c.lastHumanMessageAt ? new Date(c.lastHumanMessageAt).getTime() : 0;
                wasUnread = !!userTime && userTime > humanTime;
                // Decrement tag counts
                const deletedTags = cleanTagValues(c.tags);
                if (deletedTags.length > 0) {
                    const tp = client.pipeline();
                    deletedTags.forEach(t => tp.hincrby('candidatic:tag_counts', t, -1));
                    tp.exec().catch(() => {});
                } else {
                    client.eval(
                        "local current = tonumber(redis.call('GET', KEYS[1]) or '0'); if current > 0 then return redis.call('DECR', KEYS[1]); end; return current;",
                        1,
                        UNTAGGED_COUNT_KEY
                    ).catch(() => {});
                }
                syncCandidateSecondaryIndexes(client, c, null).catch(() => {});
            }
        } catch (_) {}

        // 2. Atomic cleanup from stat sets + PHONE_INDEX
        const multi = client.multi()
            .srem(KEYS.LIST_COMPLETE, id)
            .srem(KEYS.LIST_PENDING, id)
            .srem(KEYS.CANDIDATES_UNREAD, id)
            .zrem(INDEX_KEYS.UNTAGGED, id);
        if (wasUnread) {
            multi.eval(
                "local current = tonumber(redis.call('GET', KEYS[1]) or '0'); if current > 0 then return redis.call('DECR', KEYS[1]); end; return current;",
                1,
                'stats:bot:unread_v2'
            );
            multi.incr('stats:unread:version');
        }
        if (phone) {
            multi.hdel(KEYS.PHONE_INDEX, phone);
            // Also clean common Mexico variations
            const last10 = phone.slice(-10);
            if (last10.length === 10) {
                ['52' + last10, '521' + last10, last10].forEach(v => {
                    if (v !== phone) multi.hdel(KEYS.PHONE_INDEX, v);
                });
            }
        }
        await multi.exec();
        _publishGlobalStats(client).catch(() => {});

        // 3. Deep clean: all TTL-based state keys tied to candidateId
        const stateKeys = [
            `cita_pending:${id}`,
            `pivot_pending:${id}`,
            `ni_gate:${id}`,
            `cta_idx:${id}`,
            `day_list_pending:${id}`,
            `day_list_rejection_count:${id}`,
            `messages:${id}`,
            `${KEYS.CANDIDATE_LOCK_PREFIX}${id}`,
            `debug:last_response:${id}`,
            `debug:ultramsg:${phone || id}`,
            `noInteresa:${id}`,
            `vacancy_history:${id}`,
        ];
        await client.del(...stateKeys).catch(() => {});

        // 3b. Cancelar recordatorios directos/plantilla pendientes — son autocontenidos
        // (guardan whatsapp/message propios, no dependen de que el candidato exista),
        // así que sin esto un candidato borrado seguía recibiendo el mensaje de todas
        // formas. Ver auditoría 2026-08-07.
        try {
            const directReminderIds = await client.smembers(`direct_reminders:candidate:${id}`);
            if (directReminderIds.length > 0) {
                const cleanupMulti = client.multi().zrem('direct_reminders', ...directReminderIds);
                directReminderIds.forEach(remId => cleanupMulti.del(`direct_reminder:${remId}`));
                cleanupMulti.del(`direct_reminders:candidate:${id}`);
                await cleanupMulti.exec();
            }
        } catch (_) {}

        // 4. Clean pipeline processed markers (scan pattern pipeline:*:*:id:processed)
        try {
            let cursor = '0';
            do {
                const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `pipeline:*:*:${id}:*`, 'COUNT', 50);
                cursor = nextCursor;
                if (keys && keys.length > 0) await client.del(...keys);
            } while (cursor !== '0');
        } catch (_) {}
    }

    const deleted = await deleteDistributedItem(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX, id);
    if (deleted) {
        import('./sse-notify.js').then(({ notifyCandidateDelete }) => {
            notifyCandidateDelete(id).catch(() => {});
        }).catch(() => {});
    }
    return deleted;
};

/**
 * Valida un sessionToken de admin contra Redis.
 * Retorna el userId si es válido, null si no.
 */
export const validateAdminSession = async (req) => {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return null;
    const client = getClient();
    if (!client) return null;
    const key = `session:admin:${token}`;
    const raw = await client.get(key);
    if (!raw) return null;

    try {
        const session = JSON.parse(raw);
        const expiresMs = new Date(session.expiresAt).getTime();
        if (!session.userId || !Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
            await client.del(key).catch(() => {});
            return null;
        }
        return session.userId;
    } catch {
        // Legacy 24h sessions did not store expiry metadata. Force re-login so
        // every active browser moves to the 8h expiry contract immediately.
        await client.del(key).catch(() => {});
        return null;
    }
};

export const getCandidateById = async (id) => {
    const client = getClient();
    if (!client) return null;
    const data = await client.get(`${KEYS.CANDIDATE_PREFIX}${id}`);
    if (!data) return null;
    const candidate = JSON.parse(data);
    const normalized = normalizeCandidateSilence(candidate);
    persistExpiredSilence(client, candidate, normalized);
    return normalized;
};

// Fast lookup only — no fallback scan. Returns null if not in index.
// Use this for cosmetic updates (read receipts) to avoid 2000-candidate scan.
export const getCandidateIdByPhoneFast = async (phone) => {
    if (!phone) return null;
    const target = phone.replace(/\D/g, '');
    const client = getRedisClient();
    if (!client) return null;

    let fastId = await client.hget(KEYS.PHONE_INDEX, target);
    if (fastId) return fastId;

    const last10 = target.slice(-10);
    if (last10.length === 10) {
        const variations = [last10, '52' + last10, '521' + last10];
        for (const v of variations) {
            if (v === target) continue;
            fastId = await client.hget(KEYS.PHONE_INDEX, v);
            if (fastId) return fastId;
        }
    }
    return null;
};

// Optimized Lookup: O(1) Redis Hash
export const getCandidateIdByPhone = async (phone) => {
    if (!phone) return null;
    const target = phone.replace(/\D/g, '');
    const client = getRedisClient();

    if (client) {
        // 1. Try direct match
        let fastId = await client.hget(KEYS.PHONE_INDEX, target);
        if (fastId) return fastId;

        // 2. Try variations (especially for Mexico 52 vs 521)
        const last10 = target.slice(-10);
        if (last10.length === 10) {
            const variations = [last10, '52' + last10, '521' + last10];
            for (const v of variations) {
                if (v === target) continue;
                fastId = await client.hget(KEYS.PHONE_INDEX, v);
                if (fastId) return fastId;
            }
        }
    }

    // 3. Fallback to full search (Legacy upgrade/Safety)
    const { candidates } = await getCandidates(2000); // Increased limit for safety
    const match = candidates.find(c => {
        if (!c.whatsapp) return false;
        const dbPhone = c.whatsapp.replace(/\D/g, '');
        const dbLast10 = dbPhone.slice(-10);
        const targetLast10 = target.slice(-10);
        return dbLast10 === targetLast10 && dbLast10.length === 10;
    });

    if (match && client) {
        // Self-heal index
        await client.hset(KEYS.PHONE_INDEX, target, match.id).catch(() => { });
    }

    return match ? match.id : null;
};

/**
 * 🔒 MESSAGE DEDUPLICATION (Two-Phase Commit)
 * Prevents multiple webhooks for the same message from being processed.
 */
export const isMessageProcessed = async (msgId) => {
    const client = getRedisClient();
    if (!client || !msgId) return false;
    const key = `${KEYS.DEDUPE_PREFIX}${msgId}`;
    /**
     * ATOMIC LOCK: 'NX' means "Only set if NOT exists"
     * Initially set for 10 minutes to cover the processing window.
     * Webhook MUST call markMessageAsDone() to extend to 24h or unlockMessage() to abort.
     */
    const result = await client.set(key, 'PROCESSING', 'EX', 600, 'NX');
    return result !== 'OK';
};

export const markMessageAsDone = async (msgId) => {
    const client = getRedisClient();
    if (!client || !msgId) return;
    const key = `${KEYS.DEDUPE_PREFIX}${msgId}`;
    // Finalize: Set to '1' and extend to 24 hours
    await client.set(key, '1', 'EX', 86400);
};

export const unlockMessage = async (msgId) => {
    const client = getRedisClient();
    if (!client || !msgId) return;
    const key = `${KEYS.DEDUPE_PREFIX}${msgId}`;
    await client.del(key);
};

/**
 * 🏎️ FERRARI CANDIDATE LOCK: Prevents simultaneous AI processing for the same candidate.
 */
export const isCandidateLocked = async (candidateId) => {
    const client = getRedisClient();
    if (!client || !candidateId) return false;
    const key = `${KEYS.CANDIDATE_LOCK_PREFIX}${candidateId}`;
    /**
     * ATOMIC LOCK: 'NX' means "Only set if NOT exists"
     * 30s TTL: enough for a full step-move sequence (media + stickers + delays ~20-25s)
     * without being so long that it blocks rapid-fire messages for too long.
     */
    const result = await client.set(key, '1', 'EX', 30, 'NX');
    return result !== 'OK';
};

export const unlockCandidate = async (candidateId) => {
    const client = getRedisClient();
    if (!client || !candidateId) return;
    const key = `${KEYS.CANDIDATE_LOCK_PREFIX}${candidateId}`;
    await client.del(key);
};

// --- INDUSTRIAL WAITLIST HELPERS ---
export const addToWaitlist = async (candidateId, text) => {
    const client = getRedisClient();
    if (!client || !candidateId) return;
    const key = `${KEYS.CANDIDATE_WAITLIST_PREFIX}${candidateId}`;
    const value = typeof text === 'object' ? JSON.stringify(text) : text;
    await client.rpush(key, value);
    await client.expire(key, 120); // 2-minute safety TTL (accounts for GPT + cleaners + media)
};

// 🛡️ SAFETY NET: Just PEEK at the messages. Do NOT delete them yet.
export const getWaitlist = async (candidateId) => {
    const client = getRedisClient();
    if (!client || !candidateId) return [];
    const key = `${KEYS.CANDIDATE_WAITLIST_PREFIX}${candidateId}`;
    try {
        // Just get the range. Don't delete.
        const messages = await client.lrange(key, 0, -1);
        return messages || [];
    } catch (e) {
        console.error('❌ [Storage] getWaitlist Error:', e);
        return [];
    }
};

// 🧹 CLEANUP: Removes only the messages that were successfully processed
export const clearWaitlist = async (candidateId, processedCount = 0) => {
    const client = getRedisClient();
    if (!client || !candidateId) return;
    const key = `${KEYS.CANDIDATE_WAITLIST_PREFIX}${candidateId}`;
    try {
        if (processedCount > 0) {
            // Remove exactly the number of messages we processed from the LEFT (oldest)
            // LTRIM start end. If we processed 1, we want to keep index 1 to -1.
            await client.ltrim(key, processedCount, -1);
        } else {
            await client.del(key);
        }
    } catch (e) {
        console.error('❌ [Storage] clearWaitlist Error:', e);
    }
};

export const updateCandidate = async (id, data) => {
    // 🛑 SIMULATOR SHIELD: Short-circuit updates for the mock candidate
    if (String(id).startsWith('sim_')) {
        const client = getRedisClient();
        const existingDataStr = await client?.get(id);
        const existingData = existingDataStr ? JSON.parse(existingDataStr) : {};
        const merged = { ...existingData, ...data };
        await client?.set(id, JSON.stringify(merged), 'EX', 3600);
        return merged;
    }

    const candidate = await getCandidateById(id);
    if (!candidate) return null;
    const updated = { ...candidate, ...data };

    // ATOMIC TAG COUNTS: keep candidatic:tag_counts hash in sync when tags change
    if ('tags' in data) {
        const oldSet = new Set(cleanTagValues(candidate.tags));
        const newSet = new Set(cleanTagValues(data.tags));
        const added   = [...newSet].filter(t => !oldSet.has(t));
        const removed = [...oldSet].filter(t => !newSet.has(t));
        const wasUntagged = oldSet.size === 0;
        const isUntagged = newSet.size === 0;
        if (added.length || removed.length || wasUntagged !== isUntagged) {
            const tc = getRedisClient();
            if (tc) {
                const p = tc.pipeline();
                added.forEach(t => p.hincrby('candidatic:tag_counts', t, 1));
                removed.forEach(t => p.hincrby('candidatic:tag_counts', t, -1));
                // Altas por ETIQUETA y día (para "cuántos de Yageo llegaron hoy"), sumado
                // también aquí y no solo al crearse (ver saveCandidate): en la práctica las
                // etiquetas de anuncio se asignan en un updateCandidate() posterior a la
                // creación, así que el contador de creación casi nunca las veía — quedaba
                // en 0 aunque el candidato sí tuviera la etiqueta. Se cuenta el día en que
                // se ASIGNA la etiqueta (no el de creación del candidato), mismo pipeline
                // ya en vuelo — no agrega ninguna llamada extra a Redis.
                if (added.length) {
                    const tagDateKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
                    added.forEach(t => p.hincrby(`stats:daily:captures:tag:${t}`, tagDateKey, 1));
                }
                if (wasUntagged && !isUntagged) {
                    p.eval(
                        "local current = tonumber(redis.call('GET', KEYS[1]) or '0'); if current > 0 then return redis.call('DECR', KEYS[1]); end; return current;",
                        1,
                        UNTAGGED_COUNT_KEY
                    );
                }
                if (!wasUntagged && isUntagged) p.incr(UNTAGGED_COUNT_KEY);
                p.exec().catch(() => {});
            }
        }
    }

    // 📊 ATOMIC UNREAD: Track unread state using timestamps (lastUserMessageAt > lastHumanMessageAt)
    {
        const _isUnread = (c) => {
            const ut = c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;
            if (!ut) return false;
            const ht = c.lastHumanMessageAt ? new Date(c.lastHumanMessageAt).getTime() : 0;
            return ut > ht;
        };
        const wasUnread = _isUnread(candidate);
        const isNowUnread = _isUnread(updated);
        if (wasUnread !== isNowUnread) {
            const redisAtomic = getRedisClient();
            if (redisAtomic) {
                if (wasUnread && !isNowUnread) {
                    await redisAtomic.eval(
                        "local current = tonumber(redis.call('GET', KEYS[1]) or '0'); if current > 0 then return redis.call('DECR', KEYS[1]); end; return current;",
                        1,
                        'stats:bot:unread_v2'
                    ).catch(() => {});
                    await redisAtomic.srem(KEYS.CANDIDATES_UNREAD, id).catch(() => {});
                } else {
                    await redisAtomic.incr('stats:bot:unread_v2').catch(() => {});
                    await redisAtomic.sadd(KEYS.CANDIDATES_UNREAD, id).catch(() => {});
                }
                await redisAtomic.incr('stats:unread:version').catch(() => {});
                // Broadcast updated unread count to all SSE clients immediately
                _publishGlobalStats(redisAtomic).catch(() => {});
            }
        } else if (isNowUnread) {
            const unreadBucketKeys = [
                'tags',
                'manualProjectId',
                'statusAudit',
                'nombreReal',
                'nombre',
                'edad',
                'fechaNacimiento',
                'genero',
                'municipio',
                'escolaridad',
                'categoria'
            ];
            if (unreadBucketKeys.some(key => key in data)) {
                const redisAtomic = getRedisClient();
                if (redisAtomic) {
                    await redisAtomic.incr('stats:unread:version').catch(() => {});
                    _publishGlobalStats(redisAtomic).catch(() => {});
                }
            }
        }
    }

    // [SIN TANTO ROLLO] Atomic Status Sync
    await syncCandidateStats(id, updated);

    const saved = await saveCandidate(updated);
    syncCandidateSecondaryIndexes(getRedisClient(), candidate, updated).catch(() => {});
    
    // Fire SSE — include statusAudit so the green dot updates instantly on the frontend
    import('./sse-notify.js').then(({ notifyCandidateUpdate }) => {
        const ssePayload = updated.statusAudit ? { ...data, statusAudit: updated.statusAudit } : data;
        notifyCandidateUpdate(id, ssePayload).catch(() => {});
    }).catch(() => {});
    
    return saved;
};

export const saveLastResponse = async (id, response) => {
    const client = getClient();
    if (!client) return;
    await client.set(`debug:last_response:${id}`, JSON.stringify({
        timestamp: new Date().toISOString(),
        response
    }), 'EX', 3600); // 1 hour expiry
};

export const setLastActiveUser = async (phone) => {
    const client = getClient();
    if (!client) return;
    await client.set('meta:last_active_user', phone);
};

export const getLastActiveUser = async () => {
    const client = getClient();
    if (!client) return null;
    return await client.get('meta:last_active_user');
};

export const getCandidatesStats = async () => {
    const client = getClient();
    if (!client) return { total: 0 };
    // [SIN TANTO ROLLO] Sum of Sets for ultra-fast total
    const complete = await client.scard(KEYS.LIST_COMPLETE);
    const pending = await client.scard(KEYS.LIST_PENDING);
    return {
        total: complete + pending,
        complete,
        pending
    };
};

/**
 * ==========================================
 * USERS (Blob)
 * ==========================================
 */
export const getUsers = async () => {
    const client = getClient();
    if (!client) return [];
    const data = await client.get(KEYS.USERS);
    let users = [];
    if (data) {
        try {
            users = JSON.parse(data);
        } catch (e) {
            console.error('❌ Corrupt Users Data Found (resetting):', e);
            users = [];
        }
    }

    // FORCE SEED: Ensure Super Admin always exists
    const adminPhone = '5218116038195';
    const adminIndex = users.findIndex(u => u.whatsapp === adminPhone);

    if (adminIndex === -1) {
        const defaultAdmin = {
            id: 'user_default_admin',
            name: 'Oscar Rodriguez',
            whatsapp: adminPhone,
            role: 'SuperAdmin',
            status: 'Active',
            createdAt: new Date().toISOString()
        };
        users.push(defaultAdmin);
        await client.set(KEYS.USERS, JSON.stringify(users));
    } else {
        // Force Active status/Role if exists
        const current = users[adminIndex];
        if (current.status !== 'Active' || current.role !== 'SuperAdmin') {
            users[adminIndex] = {
                ...current,
                role: 'SuperAdmin',
                status: 'Active'
            };
            await client.set(KEYS.USERS, JSON.stringify(users));
        }
    }

    return users;
};


export const saveUser = async (user) => {
    const client = getClient();
    if (!client) return;
    const users = await getUsers();
    const index = users.findIndex(u => u.id === user.id || u.whatsapp === user.whatsapp);
    if (index >= 0) users[index] = { ...users[index], ...user };
    else users.push(user);
    await client.set(KEYS.USERS, JSON.stringify(users));
    return user;
};

export const deleteUser = async (id) => {
    const client = getClient();
    if (!client) return;
    const users = await getUsers();

    // Check if trying to delete Super Admin
    const userToDelete = users.find(u => u.id === id || u.whatsapp === (id.whatsapp || id));
    // Hardcoded protection for main admin
    if (userToDelete && (userToDelete.whatsapp === '5218116038195' || userToDelete.role === 'SuperAdmin')) {
        console.warn('⛔️ Intento de eliminar Super Admin bloqueado.');
        return false;
    }

    const newUsers = users.filter(u => u.id !== id && u.whatsapp !== id);
    await client.set(KEYS.USERS, JSON.stringify(newUsers));
    return true;
};

/**
 * ==========================================
 * ROLES (Blob)
 * ==========================================
 */
export const getRoles = async () => {
    const client = getClient();
    if (!client) return [];
    const data = await client.get(KEYS.ROLES);
    let roles = [];
    if (data) {
        try {
            roles = JSON.parse(data);
        } catch (e) {
            console.error('❌ Corrupt Roles Data Found (resetting):', e);
            roles = [];
        }
    }

    // Default roles if none exist
    if (roles.length === 0) {
        const defaultRoles = [
            {
                id: 'role_superadmin',
                name: 'SuperAdmin',
                permissions: {
                    settings: true,
                    candidates: true,
                    chat: true,
                    "bot-ia": true,
                    simulator: true,
                    automations: true,
                    vacancies: true,
                    history: true,
                    users: true,
                    "media-library": true,
                    projects: true,
                    bypass: true,
                    instances: true
                },
                createdAt: new Date().toISOString()
            },
            {
                id: 'role_admin',
                name: 'Admin',
                permissions: {
                    settings: false,
                    candidates: true,
                    chat: true,
                    "bot-ia": true,
                    simulator: true,
                    automations: true,
                    vacancies: true,
                    history: true,
                    users: true,
                    "media-library": true,
                    projects: true,
                    bypass: true,
                    instances: false
                },
                createdAt: new Date().toISOString()
            },
            {
                id: 'role_recruiter',
                name: 'Recruiter',
                permissions: {
                    settings: false,
                    candidates: true,
                    chat: true,
                    "bot-ia": false,
                    simulator: true,
                    automations: false,
                    vacancies: true,
                    history: true,
                    users: false,
                    "media-library": true,
                    projects: true,
                    bypass: false,
                    instances: false
                },
                createdAt: new Date().toISOString()
            }
        ];
        roles = defaultRoles;
        await client.set(KEYS.ROLES, JSON.stringify(roles));
    }

    return roles;
};

export const saveRole = async (role) => {
    const client = getClient();
    if (!client) return;
    const roles = await getRoles();
    const index = roles.findIndex(r => r.id === role.id || r.name === role.name);
    if (index >= 0) {
        roles[index] = { ...roles[index], ...role, id: roles[index].id }; // preserve ID if updating by name
    } else {
        if (!role.id) role.id = `role_${Date.now()}`;
        roles.push(role);
    }
    await client.set(KEYS.ROLES, JSON.stringify(roles));
    return role;
};

export const deleteRole = async (id) => {
    const client = getClient();
    if (!client) return;
    const roles = await getRoles();

    const roleToDelete = roles.find(r => r.id === id);
    if (roleToDelete && (roleToDelete.name === 'SuperAdmin')) {
        console.warn('⛔️ Intento de eliminar rol SuperAdmin bloqueado.');
        return false;
    }

    const newRoles = roles.filter(r => r.id !== id);
    await client.set(KEYS.ROLES, JSON.stringify(newRoles));
    return true;
};

/**
 * ==========================================
 * VACANCIES (Blob) 💼
 * ==========================================
 */
// In-memory cache for vacancies — 182 KB key, avoid re-reading on every getVacancyById call
let _vacanciesCache = null;
let _vacanciesCacheAt = 0;
const VACANCIES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const getVacancies = async () => {
    const now = Date.now();
    if (_vacanciesCache && (now - _vacanciesCacheAt) < VACANCIES_CACHE_TTL) {
        return _vacanciesCache;
    }
    const client = getClient();
    if (!client) return [];
    try {
        const data = await client.get(KEYS.VACANCIES);
        _vacanciesCache = data ? JSON.parse(data) : [];
        _vacanciesCacheAt = now;
        return _vacanciesCache;
    } catch (e) {
        console.error('Error fetching vacancies:', e);
        return _vacanciesCache || [];
    }
};

export const invalidateVacanciesCache = () => {
    _vacanciesCache = null;
    _vacanciesCacheAt = 0;
};

export const getVacancyById = async (id) => {
    const list = await getVacancies();
    return list.find(v => v.id === id);
};

export const saveVacancy = async (vacancy) => {
    const client = getClient();
    if (!client) return;
    const vacancies = await getVacancies();

    if (!vacancy.id) {
        vacancy.id = `vac_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        vacancy.createdAt = new Date().toISOString();
        vacancy.status = 'active'; // default
    }

    const index = vacancies.findIndex(v => v.id === vacancy.id);
    if (index >= 0) vacancies[index] = { ...vacancies[index], ...vacancy };
    else vacancies.push(vacancy);

    await client.set(KEYS.VACANCIES, JSON.stringify(vacancies));
    invalidateVacanciesCache();
    return vacancy;
};

export const deleteVacancy = async (id) => {
    const client = getClient();
    if (!client) return;
    const vacancies = await getVacancies();
    const newVacancies = vacancies.filter(v => v.id !== id);
    await client.set(KEYS.VACANCIES, JSON.stringify(newVacancies));
    return true;
};


/**
 * ==========================================
 * EVENTS & MESSAGES
 * ==========================================
 */
export const saveEvent = async (event) => {
    const client = getClient();
    if (client) {
        const eventWithId = { ...event, id: Date.now() };
        // Use try-catch for list ops
        try {
            await client.lpush(KEYS.EVENTS_LIST, JSON.stringify(eventWithId));
            await client.ltrim(KEYS.EVENTS_LIST, 0, 99);
        } catch (e) { console.error('Redis List push error', e); }
        return eventWithId;
    }
    return { id: 'no-client' };
};

export const getEvents = async (limit = 50, offset = 0) => {
    const client = getClient();
    if (!client) return [];
    try {
        const raw = await client.lrange(KEYS.EVENTS_LIST, offset, offset + limit - 1);
        return raw.map(r => JSON.parse(r));
    } catch { return []; }
};

export const getEventsByType = async (type, limit = 50) => {
    const events = await getEvents(100);
    return events.filter(e => e.event_type === type || e.event === type).slice(0, limit);
};

export const getEventStats = async () => {
    const client = getClient();
    if (!client) return { total: 0 };
    const count = await client.llen(KEYS.EVENTS_LIST);
    const incoming = await client.get(KEYS.STATS_INCOMING) || 0;
    const outgoing = await client.get(KEYS.STATS_OUTGOING) || 0;

    return {
        total: count,
        incoming: parseInt(incoming),
        outgoing: parseInt(outgoing)
    };
};

export const incrementMessageStats = async (type = 'incoming') => {
    const client = getRedisClient();
    if (!client) return;
    const key = type === 'incoming' ? KEYS.STATS_INCOMING : KEYS.STATS_OUTGOING;
    try {
        await client.incr(key);
        _publishGlobalStats(client).catch(() => {});
    } catch (e) {
        console.error('Stats increment error:', e);
    }
};

export const getRecentMessages = async (candidateId, limit = 20) => {
    const client = getClient();
    if (!client) return [];
    const key = `messages:${candidateId}`;
    try {
        // Fetch only the last N items (Redis lrange uses 0-based index)
        const raw = await client.lrange(key, -limit, -1);
        return raw.map(r => JSON.parse(r));
    } catch { return []; }
};

export const getMessages = async (candidateId, limit = 100) => {
    // Respeta el limite que pide quien llama. Antes ignoraba el argumento y SIEMPRE leia
    // 100 — el agente pide 40 por mensaje (ver agent.js "Memory Boost: 40 messages") pero
    // recibia 100, leyendo 2.5x mas historial del necesario en cada respuesta (la lectura
    // mas pesada del path caliente). Los callers sin argumento siguen con 100 (compatibilidad).
    return await getRecentMessages(candidateId, limit);
};

export const saveMessage = async (candidateId, message) => {
    // 🛑 SIMULATOR SHIELD: Short-circuit message queues for mock candidates.
    if (String(candidateId).startsWith('sim_')) {
        return message; 
    }

    // Ensure message has an ID so SSE real-time tracking doesn't accidentally overwrite undefined IDs
    if (!message.id) {
        message.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    const client = getClient();
    if (!client) {
        console.error('❌ [Storage] saveMessage failed: No Redis client');
        return null;
    }
    const key = `messages:${candidateId}`;
    try {
        if ((message.from === 'bot' || message.from === 'me') && !message.status) {
            message.status = 'read';
        }
        await client.rpush(key, JSON.stringify(message));
        // Cap at 500 messages to prevent unbounded growth
        await client.ltrim(key, -500, -1);

        // 📊 ACTIVITY TRACKER: Update sorted set for O(log N) inactivity queries
        await client.zadd('activity:tracker', Date.now(), candidateId).catch(() => {});

        // Detection of follow-up messages to increment counter
        const isFollowUp =
            message.from === 'bot' &&
            message.meta &&
            (message.meta.automationId || message.meta.proactiveLevel || message.meta.pipelineStep);

        if (isFollowUp) {
            const candKey = `candidate:${candidateId}`;
            const candRaw = await client.get(candKey);
            if (candRaw) {
                const cand = JSON.parse(candRaw);
                cand.followUps = (cand.followUps || 0) + 1;
                await client.set(candKey, JSON.stringify(cand));
                console.log(`[Storage] Follow-up detected for ${candidateId}. Count: ${cand.followUps}`);
            }
        }

        // TRIGGER SSE: Notify all connected frontends for real-time multi-recruiter sync.
        // 'me' messages ARE included so other recruiters viewing the same chat see them instantly.
        // The sender's own client deduplicates via ID or content match (no flash/duplication).
        {
            const now = new Date().toISOString();
            const isFromUser = message.from === 'user';
            const isFromMe = message.from === 'me';
            try {
                const { notifyCandidateUpdate } = await import('./sse-notify.js');
                await notifyCandidateUpdate(candidateId, {
                    newMessage: true,
                    messagePayload: message,
                    messageFrom: message.from,
                    ultimoMensaje: now,
                    // Only increment unread for real candidate messages; bot/recruiter replies don't
                    ...(isFromUser ? { lastUserMessageAt: now } : {}),
                    ...((!isFromUser && !isFromMe) ? { lastBotMessageAt: now } : {})
                });
            } catch (err) {
                console.error('Error in SSE notify:', err);
            }
        }

    } catch (e) {
        console.error('❌ [Storage] saveMessage Error:', e);
    }
    return message;
};

export const updateMessageStatus = async (candidateId, ultraMsgId, status, additionalData = {}) => {
    const client = getClient();
    if (!client || !candidateId || !ultraMsgId) return false;

    const key = `messages:${candidateId}`;
    try {
        const STATUS_RANK = { failed: -1, queued: 0, pending: 0, sent: 1, delivered: 2, read: 3, seen: 3 };

        const persistIndex = async (msg, absoluteIndex) => {
            const ids = [msg?.id, msg?.ultraMsgId].filter(Boolean);
            if (ids.length === 0) return;
            const pipe = client.pipeline();
            ids.forEach(id => {
                pipe.set(`message:index:${id}`, JSON.stringify({ candidateId, index: absoluteIndex }), 'EX', 86400 * 30);
            });
            await pipe.exec().catch(() => {});
        };

        const notifyStatus = async (id = ultraMsgId, nextStatus = status, nextAdditionalData = additionalData) => {
            try {
                const { notifyCandidateUpdate } = await import('./sse-notify.js');
                await notifyCandidateUpdate(candidateId, {
                    messageStatusUpdate: { id, status: nextStatus, additionalData: nextAdditionalData }
                });
            } catch (err) {
                console.error("Could not import sse-notify", err);
            }
        };

        const applyPendingStatusIfNewer = async (msg, absoluteIndex) => {
            const remoteId = msg?.ultraMsgId;
            if (!remoteId) return msg;

            const pendingRaw = await client.get(`message:pendingStatus:${remoteId}`).catch(() => null);
            if (!pendingRaw) return msg;

            try {
                const pending = JSON.parse(pendingRaw);
                if (pending?.candidateId !== candidateId) return msg;

                const pendingStatus = pending.status;
                const pendingAdditionalData = pending.additionalData || {};
                const shouldApply = pendingStatus === 'failed' ||
                    (STATUS_RANK[pendingStatus] ?? 0) > (STATUS_RANK[msg.status] ?? 0);

                await client.del(`message:pendingStatus:${remoteId}`).catch(() => {});
                if (!shouldApply) return msg;

                const nextMsg = { ...msg, status: pendingStatus, ...pendingAdditionalData };
                await client.lset(key, absoluteIndex, JSON.stringify(nextMsg));
                await persistIndex(nextMsg, absoluteIndex);
                await notifyStatus(remoteId, pendingStatus, pendingAdditionalData);
                return nextMsg;
            } catch {
                await client.del(`message:pendingStatus:${remoteId}`).catch(() => {});
                return msg;
            }
        };

        const cachedIndexRaw = await client.get(`message:index:${ultraMsgId}`);
        if (cachedIndexRaw) {
            try {
                const cachedIndex = JSON.parse(cachedIndexRaw);
                if (cachedIndex?.candidateId === candidateId && Number.isInteger(cachedIndex.index)) {
                    const rawMsg = await client.lindex(key, cachedIndex.index);
                    if (rawMsg) {
                        const msg = JSON.parse(rawMsg);
                        if (msg.ultraMsgId === ultraMsgId || msg.id === ultraMsgId) {
                            const oldStatus = msg.status;
                            if ((STATUS_RANK[status] ?? 0) <= (STATUS_RANK[oldStatus] ?? 0) && status !== 'failed') {
                                await applyPendingStatusIfNewer(msg, cachedIndex.index);
                                return true;
                            }
                            let nextMsg = { ...msg, status, ...additionalData };
                            await client.lset(key, cachedIndex.index, JSON.stringify(nextMsg));
                            await persistIndex(nextMsg, cachedIndex.index);
                            if (nextMsg.campaignId && oldStatus !== status && ['sent', 'delivered', 'read'].includes(status)) {
                                client.hincrby(`bulk_stats:${nextMsg.campaignId}`, status, 1).catch(() => {});
                            }
                            await notifyStatus();
                            nextMsg = await applyPendingStatusIfNewer(nextMsg, cachedIndex.index);
                            return true;
                        }
                    }
                }
            } catch {}
            await client.del(`message:index:${ultraMsgId}`).catch(() => {});
        }

        // Leer sólo los últimos 50 mensajes — mensaje reciente siempre está al final.
        // delivered/read/failed persisten por id exacto cuando Meta manda el status.
        const listLen = await client.llen(key);
        const start = Math.max(0, listLen - 50);
        const raw = await client.lrange(key, start, -1);
        const messages = raw.map(r => JSON.parse(r));

        const localIndex = messages.findIndex(m => m.ultraMsgId === ultraMsgId || m.id === ultraMsgId);
        if (localIndex !== -1) {
            const absoluteIndex = start + localIndex;
            const oldStatus = messages[localIndex].status;
            // Nunca degradar: si ya es 'read' no volver a 'delivered'
            if ((STATUS_RANK[status] ?? 0) <= (STATUS_RANK[oldStatus] ?? 0) && status !== 'failed') {
                await applyPendingStatusIfNewer(messages[localIndex], absoluteIndex);
                return true; // mensaje encontrado, pero no degradamos
            }
            messages[localIndex] = { ...messages[localIndex], status, ...additionalData };
            await client.lset(key, absoluteIndex, JSON.stringify(messages[localIndex]));
            await persistIndex(messages[localIndex], absoluteIndex);

            // 📊 UPDATE CAMPAIGN STATS
            if (messages[localIndex].campaignId && oldStatus !== status && ['sent', 'delivered', 'read'].includes(status)) {
                client.hincrby(`bulk_stats:${messages[localIndex].campaignId}`, status, 1).catch(() => {});
            }

            // 🚀 FIRE SSE! Update Chat UI checks in real time
            await notifyStatus();
            messages[localIndex] = await applyPendingStatusIfNewer(messages[localIndex], absoluteIndex);

            return true;
        } else {
            if (['delivered', 'read', 'seen', 'failed'].includes(status)) {
                await client.set(
                    `message:pendingStatus:${ultraMsgId}`,
                    JSON.stringify({ candidateId, status, additionalData, at: Date.now() }),
                    'EX',
                    60 * 60 * 2
                ).catch(() => {});
            }
            if (process.env.DEBUG_MODE === 'true' || Math.random() < 0.01) {
                console.warn(`⚠️ [Storage] updateMessageStatus: Message ${ultraMsgId} NOT FOUND in ${key}`);
            }
        }
    } catch (e) {
        console.error('❌ [Storage] updateMessageStatus Error:', e);
    }
    return false;
};

export const updateMessageReaction = async (candidateId, messageId, emoji) => {
    const client = getClient();
    if (!client || !candidateId || !messageId) return false;

    const key = `messages:${candidateId}`;
    try {
        // Leer sólo los últimos 200 mensajes (mismo patrón que updateMessageStatus)
        const listLen = await client.llen(key);
        const start = Math.max(0, listLen - 200);
        const raw = await client.lrange(key, start, -1);
        const messages = raw.map(r => JSON.parse(r));

        const localIndex = messages.findIndex(m => m.ultraMsgId === messageId || m.id === messageId);
        if (localIndex !== -1) {
            const absoluteIndex = start + localIndex;
            const msg = messages[localIndex];
            if (!msg.reactions) msg.reactions = [];

            if (!emoji) {
                msg.reactions = [];
            } else {
                const exists = msg.reactions.find(r => typeof r === 'string' ? true : r.emoji);
                if (exists) {
                    msg.reactions = [emoji];
                } else {
                    msg.reactions.push(emoji);
                }
            }

            await client.lset(key, absoluteIndex, JSON.stringify(msg));
            // Notify other clients in real-time so reactions appear without reload
            import('./sse-notify.js').then(({ notifyCandidateUpdate }) => {
                notifyCandidateUpdate(candidateId, {
                    reactionUpdate: { id: messageId, reactions: msg.reactions }
                }).catch(() => {});
            }).catch(() => {});
            return { updated: true, msg };
        }
    } catch (e) {
        console.error('❌ [Storage] updateMessageReaction Error:', e);
    }
    return false;
};

/**
 * ATOMIC WEBHOOK TRANSACTION (F1 Mode)
 * Consolidates: saveEvent, saveMessage, updateCandidate, incrementMessageStats
 * into a single network round-trip using Redis Pipelining.
 */
export const saveWebhookTransaction = async ({
    candidateId,
    message,
    candidateUpdates,
    eventData,
    statsType
}) => {
    const client = getClient();
    if (!client) return null;

    const pipeline = client.pipeline();
    let indexedCandidate = null;

    // 1. Save Event (LPUSH + LTRIM)
    if (eventData) {
        const eventWithId = { ...eventData, id: Date.now() };
        pipeline.lpush(KEYS.EVENTS_LIST, JSON.stringify(eventWithId));
        pipeline.ltrim(KEYS.EVENTS_LIST, 0, 99);
    }

    // 2. Save Message (RPUSH)
    if (candidateId && message) {
        pipeline.rpush(`messages:${candidateId}`, JSON.stringify(message));
        // Cap at 500 messages to prevent unbounded growth
        pipeline.ltrim(`messages:${candidateId}`, -500, -1);
    }

    // 3. Update Candidate (SET)
    if (candidateId && candidateUpdates) {
        // [SIN TANTO ROLLO] Ensure candidate status is synced in specialized sets
        // This makes sure new candidates or status changes are reflected in O(1) SCARD results.
        const enriched = await syncCandidateStats(candidateId, candidateUpdates, pipeline);
        const finalCandidate = enriched || candidateUpdates;
        indexedCandidate = finalCandidate;

        pipeline.set(`${KEYS.CANDIDATE_PREFIX}${candidateId}`, JSON.stringify(finalCandidate));

        // NOTA: el telefono se indexa una sola vez al crear el candidato (saveCandidate,
        // linea ~1327) — para llegar aqui candidateId ya se resolvio via ese indice o via
        // creacion reciente, asi que reescribirlo en cada mensaje es siempre redundante
        // (WhatsApp del candidato no cambia post-creacion). Confirmado con MONITOR: 40
        // HSET en 20 mensajes de prueba, todos con el mismo valor ya indexado.

        // Update Sorting Score in List
        const score = new Date(finalCandidate.ultimoMensaje || finalCandidate.primerContacto || Date.now()).getTime();
        pipeline.zadd(KEYS.CANDIDATES_LIST, score, candidateId);
    }

    // 4. Increment Stats (INCR)
    if (statsType) {
        const statsKey = statsType === 'incoming' ? KEYS.STATS_INCOMING : KEYS.STATS_OUTGOING;
        pipeline.incr(statsKey);
    }

    try {
        const results = await pipeline.exec();
        // Check for any failures in the pipeline
        const errors = results.filter(([err]) => err);
        if (errors.length > 0) {
            console.error('❌ [Storage] Pipeline Transaction had partial failures:', errors);
        } else {
            if (indexedCandidate) {
                syncCandidateSecondaryIndexes(client, null, indexedCandidate).catch(() => {});
            }
            if (statsType) {
                _publishGlobalStats(client).catch(() => {});
            }
            // 🚀 FIRE SSE! Enriched payload for surgical frontend updates (zero re-fetch)
            if (candidateId) {
                const ssePayload = { 
                    newMessage: !!message,
                    statusUpdate: !!candidateUpdates
                };
                // Enrich with the full message object so frontend can instantly inject it
                if (message) {
                    ssePayload.messagePayload = message;
                    ssePayload.messageFrom = message.from;
                }
                // Enrich with ALL candidate fields so frontend can patch locally (e.g. AI extracted fields)
                if (candidateUpdates) {
                    Object.assign(ssePayload, candidateUpdates);
                }
                try {
                    const { notifyCandidateUpdate } = await import('./sse-notify.js');
                    await notifyCandidateUpdate(candidateId, ssePayload);
                } catch (err) {
                    console.error('Error in SSE webhook notify:', err);
                }
            }
        }
        return results;
    } catch (e) {
        console.error('❌ [Storage] Pipeline Transaction FATAL Error:', e);
        throw e;
    }
};

// --- PROJECTS ---

/**
 * Save or Update a Project
 */
export const saveProject = async (project) => {
    const client = getRedisClient();
    if (!client) return null;

    if (!project.id) {
        project.id = `proj_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        project.createdAt = new Date().toISOString();
        // Default Kanban Steps
        if (!project.steps) {
            project.steps = []; // Start with empty steps
        }
    }
    project.updatedAt = new Date().toISOString();

    const pipeline = client.pipeline();
    pipeline.set(`${KEYS.PROJECT_PREFIX}${project.id}`, JSON.stringify(project));

    // Use ZADD with current timestamp for ordering if not already in list
    // NX: Only add new elements. Don't update scores of existing elements so we don't break custom order
    pipeline.zadd(KEYS.PROJECTS_LIST, 'NX', Date.now(), project.id);

    await pipeline.exec();
    return project;
};

/**
 * Update Project Steps
 */
export const updateProjectSteps = async (projectId, steps) => {
    const project = await getProjectById(projectId);
    if (!project) return false;
    project.steps = steps;
    project.updatedAt = new Date().toISOString();
    return saveProject(project);
};

/**
 * Move Candidate to a specific Step
 */
export const moveCandidateStep = async (projectId, candidateId, stepId) => {
    const client = getRedisClient();
    if (!client) return false;

    const metadataKey = `${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${projectId}`;
    const rawMetadata = await client.hget(metadataKey, candidateId);
    const metadata = rawMetadata ? JSON.parse(rawMetadata) : {};

    metadata.stepId = stepId;
    metadata.updatedAt = new Date().toISOString();

    await client.hset(metadataKey, candidateId, JSON.stringify(metadata));

    // ⚡ REAL-TIME NOTIFICATION
    try {
        const { notifyCandidateUpdate } = await import('./sse-notify.js');
        notifyCandidateUpdate(candidateId, { stepId, projectId }).catch(() => { });
    } catch (e) { }

    return true;
};

/**
 * Update Project Candidate Metadata fields (like currentVacancyIndex)
 */
export const updateProjectCandidateMeta = async (projectId, candidateId, updates) => {
    const client = getRedisClient();
    if (!client || !projectId || !candidateId) return false;

    const metadataKey = `${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${projectId}`;
    const rawMetadata = await client.hget(metadataKey, candidateId);
    const metadata = rawMetadata ? JSON.parse(rawMetadata) : {};

    const updatedMetadata = { ...metadata, ...updates, updatedAt: new Date().toISOString() };
    await client.hset(metadataKey, candidateId, JSON.stringify(updatedMetadata));
    return true;
};

/**
 * Reorder Projects in the list
 */
export const reorderProjects = async (projectIds) => {
    const client = getRedisClient();
    if (!client) return false;

    const pipeline = client.pipeline();
    // Use the index as the score to preserve the order (lower score = higher priority/top)
    // Actually Redis ZSET default is ascending order by score.
    projectIds.forEach((id, index) => {
        pipeline.zadd(KEYS.PROJECTS_LIST, index, id);
    });

    await pipeline.exec();
    return true;
};

/**
 * Get all Projects
 */
export const getProjects = async () => {
    const client = getRedisClient();
    if (!client) return [];

    const ids = await client.zrevrange(KEYS.PROJECTS_LIST, 0, -1);
    if (!ids.length) return [];

    const keys = ids.map(id => `${KEYS.PROJECT_PREFIX}${id}`);
    const data = await client.mget(...keys);

    return data.map(d => {
        if (!d) return null;
        const p = JSON.parse(d);
        if (!p.steps) p.steps = []; // Ensure array exists but don't force defaults
        return p;
    }).filter(Boolean);
};

/**
 * Get Project by ID
 */
export const getProjectById = async (id) => {
    const client = getRedisClient();
    if (!client || !id) return null;
    const data = await client.get(`${KEYS.PROJECT_PREFIX}${id}`);
    if (!data) return null;
    const project = JSON.parse(data);
    if (project.steps === undefined || project.steps === null) project.steps = DEFAULT_PROJECT_STEPS;
    return project;
};

/**
 * Delete Project
 */
export const deleteProject = async (id) => {
    const client = getRedisClient();
    if (!client || !id) return false;

    const project = await getProjectById(id);
    const pipeline = client.pipeline();

    if (project) {
        const candidateIds = await client.smembers(`${KEYS.PROJECT_CANDIDATES_PREFIX}${id}`);
        if (candidateIds.length > 0) {
            candidateIds.forEach(cid => pipeline.hdel(KEYS.CANDIDATE_PROJECT_LINK, cid)); // This might need check
        }
    }

    pipeline.del(`${KEYS.PROJECT_PREFIX}${id}`);
    pipeline.zrem(KEYS.PROJECTS_LIST, id);
    pipeline.del(`${KEYS.PROJECT_CANDIDATES_PREFIX}${id}`);
    pipeline.del(`${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${id}`);

    await pipeline.exec();
    return true;
};

/**
 * Remove Candidate from Project
 */
export const removeCandidateFromProject = async (projectId, candidateId) => {
    const client = getRedisClient();
    if (!client) return false;

    const pipeline = client.pipeline();
    pipeline.srem(`${KEYS.PROJECT_CANDIDATES_PREFIX}${projectId}`, candidateId);
    pipeline.hdel(`${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${projectId}`, candidateId);
    pipeline.hdel(KEYS.CANDIDATE_PROJECT_LINK, candidateId);

    await pipeline.exec();
    return true;
};

/**
 * Get Project Candidates (Hydrated with full candidate data)
 */
export const getProjectCandidates = async (projectId) => {
    const client = getRedisClient();
    if (!client) return [];

    const ids = await client.smembers(`${KEYS.PROJECT_CANDIDATES_PREFIX}${projectId}`);
    if (!ids.length) return [];

    const keys = ids.map(id => `${KEYS.CANDIDATE_PREFIX}${id}`);
    const metadataKey = `${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${projectId}`;

    // Multi-get candidates and their metadata
    const pipeline = client.pipeline();
    keys.forEach(k => pipeline.get(k));
    pipeline.hgetall(metadataKey);

    const results = await pipeline.exec();
    const metadata = results.pop()[1] || {};
    const candidates = results.map(([_err, d]) => d ? JSON.parse(d) : null).filter(Boolean);

    // Attach metadata (like origin) to each candidate
    return candidates.map(c => ({
        ...c,
        projectMetadata: metadata[c.id] ? JSON.parse(metadata[c.id]) : {}
    }));
};

/**
 * Get Specific Candidate Metadata for a Project
 */
export const getProjectCandidateMetadata = async (projectId, candidateId) => {
    const client = getRedisClient();
    if (!client) return {};
    const metadataKey = `${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${projectId}`;
    const raw = await client.hget(metadataKey, candidateId);
    return raw ? JSON.parse(raw) : {};
};

/**
 * Project Search History
 */
export const addProjectSearch = async (projectId, searchData) => {
    const client = getRedisClient();
    if (!client) return false;
    const key = `${KEYS.PROJECT_SEARCHES_PREFIX}${projectId}`;
    await client.lpush(key, JSON.stringify({
        ...searchData,
        timestamp: new Date().toISOString()
    }));
    await client.ltrim(key, 0, 49); // Keep last 50 searches
    return true;
};

export const getProjectSearches = async (projectId) => {
    const client = getRedisClient();
    if (!client) return [];
    const data = await client.lrange(`${KEYS.PROJECT_SEARCHES_PREFIX}${projectId}`, 0, -1);
    return data.map(d => JSON.parse(d));
};

/**
 * Add Candidate to Project with Metadata (Origin)
 */
export const addCandidateToProject = async (projectId, candidateId, metadata = null) => {
    const client = getRedisClient();
    if (!client) return { success: false };

    const pipeline = client.pipeline();
    let migratedFrom = null;

    // Exclusivity: Check if candidate is already in another project
    const currentProjectId = await client.hget(KEYS.CANDIDATE_PROJECT_LINK, candidateId);
    if (currentProjectId && currentProjectId !== projectId) {
        migratedFrom = currentProjectId;
        // Atomic removal from current project
        pipeline.srem(`${KEYS.PROJECT_CANDIDATES_PREFIX}${currentProjectId}`, candidateId);
        pipeline.hdel(`${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${currentProjectId}`, candidateId);
    }

    pipeline.sadd(`${KEYS.PROJECT_CANDIDATES_PREFIX}${projectId}`, candidateId);
    pipeline.hset(KEYS.CANDIDATE_PROJECT_LINK, candidateId, projectId);

    // Always ensure we have metadata with at least the default step
    const finalMetadata = {
        ...(metadata || {}),
        linkedAt: new Date().toISOString(),
        stepId: metadata?.stepId || 'step_new', // Default to first step
        currentVacancyIndex: 0, // Índice inicial para la cola de vacantes
        historialRechazos: []   // Historial de motivos de rechazo
    };

    pipeline.hset(
        `${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${projectId}`,
        candidateId,
        JSON.stringify(finalMetadata)
    );

    await pipeline.exec();

    // 🔥 ATOMIC OVERRIDE: Ensure the candidate root JSON has this projectId.
    // This prevents webhooks racing conditions from overwriting it with old data.
    const candRaw = await client.get(`${KEYS.CANDIDATE_PREFIX}${candidateId}`);
    if (candRaw) {
        try {
            const candJson = JSON.parse(candRaw);
            candJson.projectId = projectId;
            candJson.stepId = finalMetadata.stepId;
            await client.set(`${KEYS.CANDIDATE_PREFIX}${candidateId}`, JSON.stringify(candJson));
        } catch (e) { }
    }

    // ⚡ REAL-TIME NOTIFICATION
    try {
        const { notifyCandidateUpdate } = await import('./sse-notify.js');
        notifyCandidateUpdate(candidateId, { projectId, stepId: finalMetadata.stepId }).catch(() => { });
    } catch (e) { }

    return { success: true, migrated: !!migratedFrom, migratedFrom };
};

// ==========================================
// TELEMETRY & OBSERVABILITY (TITAN STANDARD)
// ==========================================
/**
 * recordAITelemetry
 * Professional tracking of AI performance, latency and token usage.
 */
export const recordAITelemetry = async (candidateId, action, extra = {}) => {
    const client = getClient();
    if (!client) return;

    try {
        const timestamp = new Date().toISOString();
        const event = {
            id: Math.random().toString(36).substring(7),
            timestamp,
            model: extra.model || 'unknown',
            latency: extra.latency || 0,
            tokens: extra.tokens || 0,
            success: extra.success !== false,
            action: action || 'inference',
            error: extra.error || null,
            candidateId: candidateId || null,
            extra: extra // Store full metadata
        };

        const pipeline = client.pipeline();

        // 1. Store the individual event log (Keep last 100 for deep diagnostics, 30-day TTL)
        pipeline.lpush(KEYS.TELEMETRY_AI_LOGS, JSON.stringify(event));
        pipeline.ltrim(KEYS.TELEMETRY_AI_LOGS, 0, 99);
        pipeline.expire(KEYS.TELEMETRY_AI_LOGS, 30 * 24 * 3600);

        // 2. Global Aggregates (Atomic Increments)
        pipeline.hincrby(KEYS.TELEMETRY_AI_STATS, 'total_calls', 1);
        if (event.success) {
            pipeline.hincrby(KEYS.TELEMETRY_AI_STATS, 'successful_calls', 1);
        } else {
            pipeline.hincrby(KEYS.TELEMETRY_AI_STATS, 'failed_calls', 1);
        }
        pipeline.hincrby(KEYS.TELEMETRY_AI_STATS, 'total_latency_ms', Math.round(event.latency));
        pipeline.hincrby(KEYS.TELEMETRY_AI_STATS, 'total_tokens', event.tokens || 0);

        await pipeline.exec();
    } catch (e) {
        console.warn('⚠️ Telemetry Recording Failed:', e.message);
    }
};

/**
 * getAITelemetry
 * Retrieves aggregated AI performance metrics.
 */
export const getAITelemetry = async () => {
    const client = getClient();
    if (!client) return {};

    try {
        const stats = await client.hgetall(KEYS.TELEMETRY_AI_STATS);
        const recentLogs = await client.lrange(KEYS.TELEMETRY_AI_LOGS, 0, 9);

        return {
            stats,
            recent: recentLogs.map(l => JSON.parse(l))
        };
    } catch (e) {
        return {};
    }
};

/**
 * getAdsStatistics
 * Aggregates candidates by ad campaigns.
 */
export const getAdsStatistics = async () => {
    const client = getClient();
    if (!client) return { ads: [], totalAdsLeads: 0 };

    // 🏎️ BANDWIDTH SAVER: Cache ads stats for 10 min to avoid full DB scan on every page visit
    const ADS_CACHE_KEY = 'stats:ads:cached';
    const ADS_CACHE_TTL = 10 * 60; // 10 min
    try {
        const cached = await client.get(ADS_CACHE_KEY);
        if (cached) return JSON.parse(cached);
    } catch { /* cache miss — rebuild */ }

    // Monitor: registra que corrio el scan completo de ads (dato para el medidor)
    recordScanEvent(client, 'ads_stats');

    const totalDbCount = async () => (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
    const dbSize = await totalDbCount();

    const adsMap = new Map();
    let totalAdsLeads = 0;
    
    const CHUNK_SIZE = 500;
    let currentIndex = 0;
    
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Monterrey' });

    while (currentIndex < dbSize) {
        const ids = await client.zrevrange(KEYS.CANDIDATES_LIST, currentIndex, currentIndex + CHUNK_SIZE - 1);
        if (!ids || ids.length === 0) break;
        
        const pipeline = client.pipeline();
        ids.forEach(id => pipeline.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
        const results = await pipeline.exec();
        
        for (let i = 0; i < results.length; i++) {
            const [err, res] = results[i];
            if (err || !res) continue;
            
            try {
                const c = JSON.parse(res);
                
                // Only process candidates from Meta Ads
                if (c.origen === 'facebook_ctwa' || c.adId || c.adHeadline) {
                    totalAdsLeads++;
                    
                    const adKey = c.adId || (c.adBody ? String(c.adBody).substring(0, 50) : null) || c.adHeadline || 'organic_or_unknown';
                    
                    if (!adsMap.has(adKey)) {
                        adsMap.set(adKey, {
                            adId: c.adId || null,
                            adHeadline: c.adHeadline || 'Anuncio sin título',
                            adBody: c.adBody || null,
                            adUrl: c.adUrl || null,
                            adSource: c.adSource || null,
                            adImageUrl: c.adImageUrl || null,
                            adVideoUrl: c.adVideoUrl || null,
                            adMediaType: c.adMediaType || null,
                            totalLeads: 0,
                            todayLeads: 0,
                            firstSeen: null,
                            lastSeen: null,
                            recentCandidates: []
                        });
                    }
                    
                    const adStats = adsMap.get(adKey);
                    adStats.totalLeads++;
                    
                    // Track first/last candidate dates
                    const firstContact = c.primerContacto || c.createdAt; // Use creation date for first seen
                    const lastContact = c.ultimoMensaje || firstContact;
                    
                    if (firstContact) {
                        if (!adStats.firstSeen || firstContact < adStats.firstSeen) adStats.firstSeen = firstContact;
                    }
                    if (lastContact) {
                        if (!adStats.lastSeen || lastContact > adStats.lastSeen) adStats.lastSeen = lastContact;
                    }
                    
                    // todayLeads should only count NEW leads today, not recurring messages
                    let newLeadDateStr = '';
                    if (firstContact) {
                        try {
                            newLeadDateStr = new Date(firstContact).toLocaleDateString('en-CA', { timeZone: 'America/Monterrey' });
                        } catch (e) {
                            newLeadDateStr = firstContact.split('T')[0];
                        }
                    }
                    if (newLeadDateStr === todayStr) {
                        adStats.todayLeads++;
                    }
                    
                    // Keep up to 10 recent candidates for preview
                    if (adStats.recentCandidates.length < 10) {
                        adStats.recentCandidates.push({
                            id: c.id,
                            nombre: c.nombre,
                            whatsapp: c.whatsapp,
                            fecha: c.primerContacto || c.ultimoMensaje,
                            profilePic: c.profilePic || null
                        });
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
        
        currentIndex += CHUNK_SIZE;
    }

    // Fusiona el creativo (foto/texto) guardado UNA sola vez por anuncio en
    // ad_creative:<adId> — ya no vive en cada blob de candidato (se saco por ahorro de
    // ancho de banda). Son unas pocas lecturas (una por anuncio unico), no por candidato.
    const adEntries = [...adsMap.values()].filter(a => a.adId);
    if (adEntries.length) {
        try {
            const cp = client.pipeline();
            adEntries.forEach(a => cp.get(`ad_creative:${a.adId}`));
            const crows = await cp.exec();
            adEntries.forEach((ad, i) => {
                const raw = crows[i]?.[1];
                if (!raw) return;
                try {
                    const cr = JSON.parse(raw);
                    ad.adImageUrl = ad.adImageUrl || cr.adImageUrl || null;
                    ad.adBody = ad.adBody || cr.adBody || null;
                    ad.adUrl = ad.adUrl || cr.adUrl || null;
                    ad.adVideoUrl = ad.adVideoUrl || cr.adVideoUrl || null;
                    ad.adMediaType = ad.adMediaType || cr.adMediaType || null;
                } catch { /* ignore */ }
            });
        } catch { /* ignore — sin creativo la seccion sigue funcionando */ }
    }

    const ads = Array.from(adsMap.values()).sort((a, b) => b.totalLeads - a.totalLeads);

    const result = { ads, totalAdsLeads };

    // Cache for 10 min (fire-and-forget)
    try { await client.set(ADS_CACHE_KEY, JSON.stringify(result), 'EX', ADS_CACHE_TTL); } catch { /* ignore */ }

    return result;
};
