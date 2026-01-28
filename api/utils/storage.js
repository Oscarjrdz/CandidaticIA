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

    // AI Automations
    AI_AUTOMATIONS: 'ai:automations:list',

    // Projects
    PROJECTS: 'candidatic_projects',
    PROJECT_CANDIDATES_PREFIX: 'project_candidates:'
};


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
// Native Redis Pagination (Page size 100)
export const getCandidates = async (limit = 100, offset = 0, search = '') => {
    const client = getClient();
    if (!client) return { candidates: [], total: 0 };

    // If searching, we currently have to do a scan (unless we index names too)
    // For now, if search is empty, we use the ultra-fast F1 Steering.
    if (!search) {
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

    // SEARCH PATH (VW Mode for now, but filtered)
    // Optimization: Only load IDs for search to save bandwidth
    const allCandidates = await getDistributedItems(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX);
    const lowerSearch = search.toLowerCase();
    const filtered = allCandidates.filter(c =>
        (c.nombre && c.nombre.toLowerCase().includes(lowerSearch)) ||
        (c.whatsapp && c.whatsapp.includes(search)) ||
        (c.id && c.id.includes(search))
    );

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
 * ==========================================
 * PROJECTS 📂
 * ==========================================
 */
export const getProjects = async () => {
    const client = getClient();
    if (!client) return [];
    try {
        const data = await client.get(KEYS.PROJECTS);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('Error fetching projects:', e);
        return [];
    }
};

export const saveProject = async (project) => {
    const client = getClient();
    if (!client) return;
    const projects = await getProjects();

    if (!project.id) {
        project.id = `pj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        project.createdAt = new Date().toISOString();
    }

    const index = projects.findIndex(p => p.id === project.id);
    if (index >= 0) projects[index] = { ...projects[index], ...project };
    else projects.push(project);

    await client.set(KEYS.PROJECTS, JSON.stringify(projects));
    return project;
};

export const deleteProject = async (id) => {
    const client = getClient();
    if (!client) return;
    const projects = await getProjects();
    const newProjects = projects.filter(p => p.id !== id);
    await client.set(KEYS.PROJECTS, JSON.stringify(newProjects));
    // Also cleanup candidates list for this project
    await client.del(`${KEYS.PROJECT_CANDIDATES_PREFIX}${id}`);
    return true;
};

export const addCandidateToProject = async (projectId, candidateId) => {
    const client = getClient();
    if (!client) return false;
    await client.sadd(`${KEYS.PROJECT_CANDIDATES_PREFIX}${projectId}`, candidateId);
    return true;
};

export const removeCandidateFromProject = async (projectId, candidateId) => {
    const client = getClient();
    if (!client) return false;
    await client.srem(`${KEYS.PROJECT_CANDIDATES_PREFIX}${projectId}`, candidateId);
    return true;
};

export const getProjectCandidates = async (projectId) => {
    const client = getClient();
    if (!client) return [];
    const ids = await client.smembers(`${KEYS.PROJECT_CANDIDATES_PREFIX}${projectId}`);
    if (!ids || ids.length === 0) return [];

    const pipeline = client.pipeline();
    ids.forEach(id => {
        pipeline.get(`${KEYS.CANDIDATE_PREFIX}${id}`);
    });

    const results = await pipeline.exec();
    return results
        .map(([err, res]) => {
            if (err || !res) return null;
            try { return JSON.parse(res); } catch { return null; }
        })
        .filter(i => i !== null);
};
