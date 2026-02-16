/**
 * Storage Utility - Redis (ioredis) Implementation
 * Pattern: Distributed Keys (ZSET + String)
 * AUTH ENABLED
 */

import Redis from 'ioredis';

// Initialize Redis client
let redis;

const getClient = () => {
    if (!redis) {
        if (process.env.REDIS_URL) {
            try {
                const isTLS = process.env.REDIS_URL && process.env.REDIS_URL.startsWith('rediss://');
                redis = new Redis(process.env.REDIS_URL, {
                    retryStrategy: (times) => Math.min(times * 50, 2000),
                    tls: isTLS ? { rejectUnauthorized: false } : undefined
                });
                redis.on('error', (err) => console.error('❌ Redis Connection Error:', err));
            } catch (e) {
                console.error('❌ Failed to create Redis client:', e);
            }
        } else {
            console.warn('⚠️ REDIS_URL not found in environment variables.');
        }
    }
    return redis;
};

// Initialize on load
getClient();

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

    // ByPass Rules (New)
    BYPASS_LIST: 'bypass:list',
    BYPASS_PREFIX: 'bypass:'
};

export const DEFAULT_PROJECT_STEPS = [
    { id: 'step_new', name: 'Nuevos' },
    { id: 'step_contact', name: 'Contacto' },
    { id: 'step_interview', name: 'Entrevista' },
    { id: 'step_hired', name: 'Contratado' }
];


/**
 * ==========================================
 * GENERIC HELPERS 
 * ==========================================
 */
const getDistributedItems = async (listKey, itemPrefixPrefix, start = 0, stop = -1) => {
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
                try { return JSON.parse(res); } catch { return null; }
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
    // Set with expiry (5 mins)
    await client.set(`${KEYS.AUTH_PREFIX}${phone}`, pin, 'EX', 300);
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
    { value: 'nombreReal', label: 'Nombre Real', invalidValue: 'proporcionado' },
    { value: 'genero', label: 'Género', invalidValue: 'desconocido' },
    { value: 'municipio', label: 'Municipio', invalidValue: 'proporcionado' },
    { value: 'fechaNacimiento', label: 'Fecha de Nacimiento', invalidValue: 'proporcionada' },
    { value: 'categoria', label: 'Categoría', invalidValue: 'proporcionas' },
    { value: 'tieneEmpleo', label: 'Empleo', invalidValue: 'proporcionado' },
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
            val === 'ninguno' ||
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

        // --- DATE PRECISION (DD/MM/YYYY) ---
        if (field.value === 'fechaNacimiento' && !isInvalid) {
            const dateRegex = /^(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[012])\/\d{4}$/;
            if (!dateRegex.test(val)) {
                isInvalid = true;
            } else {
                // Reasonable Age Check (1940 - Current Year)
                const yearMatch = val.match(/\b(19|20)\d{2}\b/);
                if (yearMatch) {
                    const yearValue = parseInt(yearMatch[0]);
                    const currentYear = new Date().getFullYear();
                    if (yearValue < 1940 || yearValue > currentYear) isInvalid = true;
                }
            }
        }

        // --- SCHOOLING PRECISION (Requires at least Primaria) ---
        if (field.value === 'escolaridad' && !isInvalid) {
            const junkEducation = ['kinder', 'ninguno', 'ninguna', 'sin estudios', 'no tengo', 'no curse', 'preescolar', 'maternal'];
            if (junkEducation.some(e => val.includes(e))) isInvalid = true;
        }

        if (isInvalid) {
            missingLabels.push(field.label);
            missingValues.push(field.value);
        }

        dnaLinesArray.push(`- ${field.label}: ${rawVal || 'No proporcionado'}`);
    }

    // 2. Audit Custom Fields
    if (customFields && customFields.length > 0) {
        for (const cf of customFields) {
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
    return isComplete;
};

// Native Redis Pagination (Page size 100)
export const getCandidates = async (limit = 100, offset = 0, search = '', excludeLinked = false) => {
    const client = getClient();
    if (!client) return { candidates: [], total: 0 };

    // Get linked candidates set for hydration and exclusion
    const idsArray = await client.hkeys(KEYS.CANDIDATE_PROJECT_LINK);
    const linkedIds = new Set(idsArray);

    // Helper to hydrate candidates with the 'proyecto' virtual field
    const hydrate = (c) => ({
        ...c,
        proyecto: linkedIds.has(c.id) ? 1 : 0
    });

    // If searching, we currently have to do a scan (unless we index names too)
    // For now, if search is empty, we use the ultra-fast F1 Steering.
    if (!search && !excludeLinked) {
        const sumCount = async () => (await client.scard(KEYS.LIST_COMPLETE)) + (await client.scard(KEYS.LIST_PENDING));
        const stop = offset + limit - 1;
        const ids = await client.zrevrange(KEYS.CANDIDATES_LIST, offset, stop);
        if (!ids || ids.length === 0) return { candidates: [], total: await sumCount() };

        // Optimized Pipeline Loading
        const pipeline = client.pipeline();
        ids.forEach(id => pipeline.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
        const results = await pipeline.exec();

        const candidates = results
            .map(([err, res]) => (err || !res) ? null : hydrate(JSON.parse(res)))
            .filter(Boolean);

        const total = await sumCount();
        return { candidates, total };
    }

    // SEARCH PATH or EXCLUSION PATH
    // Optimization: For simplicity when filtering, we load all and filter in memory
    // TODO: Improve this with Redis-side sets intersection if performance drops
    const allCandidates = await getDistributedItems(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX);
    const lowerSearch = search.toLowerCase();

    let filtered = allCandidates;

    // Filter by Search (Universal Deep Search)
    if (search) {
        const cleanSearch = search.replace(/\D/g, '');
        filtered = filtered.filter(c => {
            // 1. Check all text/number values in the object
            const foundInFields = Object.values(c).some(val =>
                val !== null &&
                val !== undefined &&
                val.toString().toLowerCase().includes(lowerSearch)
            );
            if (foundInFields) return true;

            // 2. Special check for phone numbers (ignoring symbols)
            if (cleanSearch && c.whatsapp) {
                const cleanWhatsApp = c.whatsapp.replace(/\D/g, '');
                if (cleanWhatsApp.includes(cleanSearch)) return true;
            }

            return false;
        });
    }

    // Hydrate all with 'proyecto'
    filtered = filtered.map(hydrate);

    // Filter out Linked Candidates
    if (excludeLinked) {
        // [IRON-CLAD QUALITY SHIELD] Only show 100% complete profiles when adding to projects
        const customFieldsJson = await client.get('custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

        filtered = filtered.filter(c => {
            const isNotLinked = c.proyecto === 0;
            return isNotLinked && isProfileComplete(c, customFields);
        });
    }

    return {
        candidates: filtered.slice(offset, offset + limit),
        total: filtered.length
    };
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

        // 1. Audit
        const customFieldsJson = await client.get('custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
        const { isComplete } = auditProfile(c, customFields);

        // 2. Denormalize status inside the object
        c.statusAudit = isComplete ? 'complete' : 'pending';

        // 3. Update Sets Atomically
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
        }

        // 4. Return the enriched candidate for saving if it was passed in
        return c;
    } catch (e) {
        console.error(`❌ [Storage] syncCandidateStats Error for ${id}:`, e);
    }
};

export const saveCandidate = async (candidate) => {
    if (!candidate.id) {
        candidate.id = `cand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Indexing for O(1) Lookups
    const client = getRedisClient();
    if (client && candidate.whatsapp) {
        const cleanPhone = candidate.whatsapp.replace(/\D/g, '');
        // Store in centralized Hash for atomic O(1) lookups across all instances
        await client.hset(KEYS.PHONE_INDEX, cleanPhone, candidate.id).catch(() => { });
    }

    // [SIN TANTO ROLLO] Atomic Status Sync
    const enriched = await syncCandidateStats(candidate.id, candidate);
    const finalCandidate = enriched || candidate;

    // Sort by Last Message (Desc) or Creation Time
    const score = new Date(finalCandidate.ultimoMensaje || finalCandidate.primerContacto || Date.now()).getTime();
    return await saveDistributedItem(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX, finalCandidate, finalCandidate.id, score);
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
        // Atomic cleanup from specialized stat sets
        await client.multi()
            .srem(KEYS.LIST_COMPLETE, id)
            .srem(KEYS.LIST_PENDING, id)
            .exec();
    }
    return await deleteDistributedItem(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX, id);
};

export const getCandidateById = async (id) => {
    const client = getClient();
    if (!client) return null;
    const data = await client.get(`${KEYS.CANDIDATE_PREFIX}${id}`);
    return data ? JSON.parse(data) : null;
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
     * Reduced to 15 seconds to be less aggressive and reduce "deafness" to rapid messages.
     */
    const result = await client.set(key, '1', 'EX', 15, 'NX');
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
    await client.expire(key, 60); // 1-minute safety TTL
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

// 🧹 CLEANUP: Only call this AFTER successful processing
export const clearWaitlist = async (candidateId) => {
    const client = getRedisClient();
    if (!client || !candidateId) return;
    const key = `${KEYS.CANDIDATE_WAITLIST_PREFIX}${candidateId}`;
    try {
        await client.del(key);
    } catch (e) {
        console.error('❌ [Storage] clearWaitlist Error:', e);
    }
};

export const updateCandidate = async (id, data) => {
    const candidate = await getCandidateById(id);
    if (!candidate) return null;
    const updated = { ...candidate, ...data };

    // [SIN TANTO ROLLO] Atomic Status Sync
    await syncCandidateStats(id, updated);

    return await saveCandidate(updated);
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
            pin: '1234',
            role: 'SuperAdmin',
            status: 'Active',
            createdAt: new Date().toISOString()
        };
        users.push(defaultAdmin);
        await client.set(KEYS.USERS, JSON.stringify(users));
    } else {
        // Force Active status/Role if exists
        const current = users[adminIndex];
        // Check against 'SuperAdmin' code
        if (current.status !== 'Active' || current.role !== 'SuperAdmin' || current.pin !== '1234') {
            users[adminIndex] = {
                ...current,
                pin: '1234',
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
 * VACANCIES (Blob) 💼
 * ==========================================
 */
export const getVacancies = async () => {
    const client = getClient();
    if (!client) return [];
    try {
        const data = await client.get(KEYS.VACANCIES);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('Error fetching vacancies:', e);
        return [];
    }
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

export const getMessages = async (candidateId) => {
    return await getRecentMessages(candidateId, 100); // Fetch last 100 for deep history
};

export const saveMessage = async (candidateId, message) => {
    const client = getClient();
    if (!client) {
        console.error('❌ [Storage] saveMessage failed: No Redis client');
        return null;
    }
    const key = `messages:${candidateId}`;
    try {
        await client.rpush(key, JSON.stringify(message));

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
        const raw = await client.lrange(key, 0, -1);
        const messages = raw.map(r => JSON.parse(r));


        const index = messages.findIndex(m => m.ultraMsgId === ultraMsgId || m.id === ultraMsgId);
        if (index !== -1) {
            messages[index] = { ...messages[index], status, ...additionalData };
            await client.lset(key, index, JSON.stringify(messages[index]));
            return true;
        } else {
            console.warn(`⚠️ [Storage] updateMessageStatus: Message ${ultraMsgId} NOT FOUND in ${key}`);
        }
    } catch (e) {
        console.error('❌ [Storage] updateMessageStatus Error:', e);
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

    // 1. Save Event (LPUSH + LTRIM)
    if (eventData) {
        const eventWithId = { ...eventData, id: Date.now() };
        pipeline.lpush(KEYS.EVENTS_LIST, JSON.stringify(eventWithId));
        pipeline.ltrim(KEYS.EVENTS_LIST, 0, 99);
    }

    // 2. Save Message (RPUSH)
    if (candidateId && message) {
        pipeline.rpush(`messages:${candidateId}`, JSON.stringify(message));
    }

    // 3. Update Candidate (SET)
    if (candidateId && candidateUpdates) {
        // [SIN TANTO ROLLO] Ensure candidate status is synced in specialized sets
        // This makes sure new candidates or status changes are reflected in O(1) SCARD results.
        const enriched = await syncCandidateStats(candidateId, candidateUpdates, pipeline);
        const finalCandidate = enriched || candidateUpdates;

        pipeline.set(`${KEYS.CANDIDATE_PREFIX}${candidateId}`, JSON.stringify(finalCandidate));

        // Update Index if it's a new candidate or phone changed (safety)
        if (finalCandidate.whatsapp) {
            const cleanPhone = finalCandidate.whatsapp.replace(/\D/g, '');
            pipeline.hset(KEYS.PHONE_INDEX, cleanPhone, candidateId);
        }

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
    const candidates = results.map(([err, d]) => d ? JSON.parse(d) : null).filter(Boolean);

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
        stepId: metadata?.stepId || 'step_new' // Default to first step
    };

    pipeline.hset(
        `${KEYS.PROJECT_CANDIDATE_METADATA_PREFIX}${projectId}`,
        candidateId,
        JSON.stringify(finalMetadata)
    );

    await pipeline.exec();

    // ⚡ REAL-TIME NOTIFICATION
    try {
        const { notifyCandidateUpdate } = await import('./sse-notify.js');
        notifyCandidateUpdate(candidateId, { projectId, stepId: finalMetadata.stepId }).catch(() => { });
    } catch (e) { }

    return true;
};

// ==========================================
// TELEMETRY & OBSERVABILITY (TITAN STANDARD)
// ==========================================
/**
 * recordAITelemetry
 * Professional tracking of AI performance, latency and token usage.
 */
export const recordAITelemetry = async (data = {}) => {
    const client = getClient();
    if (!client) return;

    try {
        const timestamp = new Date().toISOString();
        const event = {
            id: Math.random().toString(36).substring(7),
            timestamp,
            model: data.model || 'unknown',
            latency: data.latency || 0,
            tokens: data.tokens || 0,
            success: data.success !== false,
            action: data.action || 'inference',
            error: data.error || null,
            candidateId: data.candidateId || null
        };

        const pipeline = client.pipeline();

        // 1. Store the individual event log (Keep last 100 for deep diagnostics)
        pipeline.lpush(KEYS.TELEMETRY_AI_LOGS, JSON.stringify(event));
        pipeline.ltrim(KEYS.TELEMETRY_AI_LOGS, 0, 99);

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
