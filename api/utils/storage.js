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
    BULKS_LIST: 'bulks:list',
    BULK_PREFIX: 'bulk:',
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

    // AI Automations
    AI_AUTOMATIONS: 'ai:automations:list',
    SCHEDULED_RULES: 'scheduled_message_rules',
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
export const isProfileComplete = (c, customFields = []) => {
    if (!c) return false;

    // 1. Standard Fields Check (High Priority)
    const standards = [
        { key: 'nombreReal', invalidValue: 'proporcionado' },
        { key: 'municipio', invalidValue: 'proporcionado' },
        { key: 'fechaNacimiento', invalidValue: 'proporcionada' },
        { key: 'categoria', invalidValue: 'proporcionado' },
        { key: 'tieneEmpleo', invalidValue: 'proporcionado' },
        { key: 'escolaridad', invalidValue: 'proporcionado' }
    ];

    for (const field of standards) {
        const val = String(c[field.key] || '').toLowerCase().trim();
        // Strict check for placeholders
        const isPlaceholder = val.includes(field.invalidValue) ||
            val === 'desconocido' ||
            val === 'consulta general' ||
            val === 'general' ||
            val === 'n/a' ||
            val === 'na' ||
            val === 'ninguno' ||
            val === 'none';

        if (!c[field.key] || isPlaceholder) {
            return false;
        }
    }

    // 2. Custom Fields Check (if any)
    if (customFields && customFields.length > 0) {
        for (const cf of customFields) {
            const val = String(c[cf.value] || '').toLowerCase();
            if (!c[cf.value] || val.includes('proporcionado')) {
                return false;
            }
        }
    }

    return true;
};

// Native Redis Pagination (Page size 100)
export const getCandidates = async (limit = 100, offset = 0, search = '', excludeLinked = false) => {
    const client = getClient();
    if (!client) return { candidates: [], total: 0 };

    // Get linked candidates set if exclusion is requested
    let linkedIds = new Set();
    if (excludeLinked) {
        const idsArray = await client.hkeys(KEYS.CANDIDATE_PROJECT_LINK);
        linkedIds = new Set(idsArray);
    }

    // If searching, we currently have to do a scan (unless we index names too)
    // For now, if search is empty, we use the ultra-fast F1 Steering.
    if (!search && !excludeLinked) {
        const stop = offset + limit - 1;
        const ids = await client.zrevrange(KEYS.CANDIDATES_LIST, offset, stop);
        if (!ids || ids.length === 0) return { candidates: [], total: await client.zcard(KEYS.CANDIDATES_LIST) };

        // Optimized Pipeline Loading
        const pipeline = client.pipeline();
        ids.forEach(id => pipeline.get(`${KEYS.CANDIDATE_PREFIX}${id}`));
        const results = await pipeline.exec();

        const candidates = results
            .map(([err, res]) => (err || !res) ? null : JSON.parse(res))
            .filter(Boolean);

        const total = await client.zcard(KEYS.CANDIDATES_LIST);
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

    // Filter out Linked Candidates
    if (excludeLinked) {
        // [IRON-CLAD QUALITY SHIELD] Only show 100% complete profiles when adding to projects
        const customFieldsJson = await client.get('custom_fields');
        const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

        filtered = filtered.filter(c => {
            const isNotLinked = linkedIds.size > 0 ? !linkedIds.has(c.id) : true;
            return isNotLinked && isProfileComplete(c, customFields);
        });
    }

    return {
        candidates: filtered.slice(offset, offset + limit),
        total: filtered.length
    };
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

    // Sort by Last Message (Desc) or Creation Time
    const score = new Date(candidate.ultimoMensaje || candidate.primerContacto || Date.now()).getTime();
    return await saveDistributedItem(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX, candidate, candidate.id, score);
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
    const target = phone.replace(/\D/g, '');
    const client = getRedisClient();

    if (client) {
        const fastId = await client.hget(KEYS.PHONE_INDEX, target);
        if (fastId) return fastId;
    }

    // 2. Fallback to full search (Legacy upgrade/Safety)
    const { candidates } = await getCandidates(1000);
    const match = candidates.find(c => {
        if (!c.whatsapp) return false;
        const dbPhone = c.whatsapp.replace(/\D/g, '');
        return dbPhone.endsWith(target) || target.endsWith(dbPhone);
    });

    if (match && client) {
        await client.hset(KEYS.PHONE_INDEX, target, match.id).catch(() => { });
    }

    return match ? match.id : null;
};

// Deduplication: Atomic SET NX
export const isMessageProcessed = async (msgId) => {
    const client = getRedisClient();
    if (!client || !msgId) return false;

    const key = `${KEYS.DEDUPE_PREFIX}${msgId}`;
    /**
     * ATOMIC LOCK: 'NX' means "Only set if NOT exists"
     * This is an atomic operation in Redis. 
     * If it returns 'OK', it was set (new). If null, it already existed.
     */
    const result = await client.set(key, '1', 'EX', 86400, 'NX');
    return result !== 'OK';
};

export const unlockMessage = async (msgId) => {
    const client = getRedisClient();
    if (!client || !msgId) return;
    const key = `${KEYS.DEDUPE_PREFIX}${msgId}`;
    await client.del(key);
};

export const updateCandidate = async (id, data) => {
    const candidate = await getCandidateById(id);
    if (!candidate) return null;
    const updated = { ...candidate, ...data };
    // NEW: Clean up some potentially large keys if they are old (optional)
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
    const count = await client.zcard(KEYS.CANDIDATES_LIST);
    return { total: count };
};

/**
 * ==========================================
 * BULKS (Distributed)
 * ==========================================
 */
export const getBulks = async () => {
    return await getDistributedItems(KEYS.BULKS_LIST, KEYS.BULK_PREFIX);
};

export const saveBulk = async (bulk) => {
    if (!bulk.id) {
        bulk.id = `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    return await saveDistributedItem(KEYS.BULKS_LIST, KEYS.BULK_PREFIX, bulk, bulk.id);
};

export const deleteBulk = async (id) => {
    return await deleteDistributedItem(KEYS.BULKS_LIST, KEYS.BULK_PREFIX, id);
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
// --- AI Automations Helpers ---
export const getAIAutomations = async () => {
    const client = getClient();
    if (!client) return [];
    const list = await client.get(KEYS.AI_AUTOMATIONS);
    return list ? JSON.parse(list) : [];
};

export const saveAIAutomation = async (automation) => {
    const client = getRedisClient();
    if (!client) return null;

    let list = await getAIAutomations();
    const existingIndex = list.findIndex(a => a.id === automation.id);

    if (existingIndex >= 0) {
        list[existingIndex] = { ...list[existingIndex], ...automation };
    } else {
        list.push({ ...automation, createdAt: new Date().toISOString(), active: true });
    }

    await client.set(KEYS.AI_AUTOMATIONS, JSON.stringify(list));
    return automation;
};

export const deleteAIAutomation = async (id) => {
    const client = getRedisClient();
    if (!client) return false;

    let list = await getAIAutomations();
    const newList = list.filter(a => a.id !== id);

    await client.set(KEYS.AI_AUTOMATIONS, JSON.stringify(newList));
    return true;
};

export const incrementAIAutomationSentCount = async (id) => {
    const client = getRedisClient();
    if (!client) return false;

    let list = await getAIAutomations();
    const index = list.findIndex(a => a.id === id);

    if (index >= 0) {
        list[index].sentCount = (list[index].sentCount || 0) + 1;
        await client.set(KEYS.AI_AUTOMATIONS, JSON.stringify(list));
        return true;
    }
    return false;
};

export const incrementScheduledRuleSentCount = async (id) => {
    const client = getRedisClient();
    if (!client) return false;

    const data = await client.get(KEYS.SCHEDULED_RULES);
    let list = data ? JSON.parse(data) : [];

    const index = list.findIndex(r => r.id === id);

    if (index >= 0) {
        list[index].sentCount = (list[index].sentCount || 0) + 1;
        await client.set(KEYS.SCHEDULED_RULES, JSON.stringify(list));
        return true;
    }
    return false;
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
    // Note: Since updateCandidate usually requires a GET first, we pass the final object here
    // or we just set specific fields if we migrate to HASHes later. 
    // For now, we expect candidateUpdates to be the FULL updated object if provided.
    if (candidateId && candidateUpdates) {
        pipeline.set(`${KEYS.CANDIDATE_PREFIX}${candidateId}`, JSON.stringify(candidateUpdates));

        // Update Index if it's a new candidate or phone changed (safety)
        if (candidateUpdates.whatsapp) {
            const cleanPhone = candidateUpdates.whatsapp.replace(/\D/g, '');
            pipeline.hset(KEYS.PHONE_INDEX, cleanPhone, candidateId);
        }

        // Update Sorting Score in List
        const score = new Date(candidateUpdates.ultimoMensaje || candidateUpdates.primerContacto || Date.now()).getTime();
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
    if (!client) return false;

    const pipeline = client.pipeline();
    // Exclusivity: Check if candidate is already in another project
    const currentProjectId = await client.hget(KEYS.CANDIDATE_PROJECT_LINK, candidateId);
    if (currentProjectId && currentProjectId !== projectId) {
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
    return true;
};
