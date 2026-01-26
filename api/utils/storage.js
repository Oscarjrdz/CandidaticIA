/**
 * Storage Utility - Redis (ioredis) Implementation
 * LEGACY DATA PATTERN RESTORED: Distributed Keys (ZSET + String)
 * + AUTH ENABLED
 */

import Redis from 'ioredis';

// Initialize Redis client
let redis;

const getClient = () => {
    if (!redis) {
        if (process.env.REDIS_URL) {
            try {
                console.log('🔌 Connecting to Redis via REDIS_URL...');
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
    DEDUPE_PREFIX: 'webhook:processed:'
};


/**
 * ==========================================
 * GENERIC HELPERS 
 * ==========================================
 */
const getDistributedItems = async (listKey, itemPrefixPrefix) => {
    const client = getClient();
    if (!client) return [];

    try {
        const ids = await client.zrevrange(listKey, 0, -1);
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

const saveDistributedItem = async (listKey, itemPrefix, item, id) => {
    const client = getClient();
    if (!client) return item;

    try {
        const key = `${itemPrefix}${id}`;
        await client.set(key, JSON.stringify(item));
        const score = Date.now();
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
export const getCandidates = async (limit = 100, offset = 0, search = '') => {
    let candidates = await getDistributedItems(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX);

    if (search) {
        const lowerSearch = search.toLowerCase();
        candidates = candidates.filter(c =>
            (c.nombre && c.nombre.toLowerCase().includes(lowerSearch)) ||
            (c.whatsapp && c.whatsapp.includes(search))
        );
    }

    return {
        candidates: candidates.slice(offset, offset + limit),
        total: candidates.length
    };
};

export const saveCandidate = async (candidate) => {
    if (!candidate.id) {
        candidate.id = `cand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    console.log(`💾 [Storage] Saving candidate ${candidate.id} (${candidate.whatsapp})...`);

    // Ferrari Index: O(1) Hash Map
    const client = getRedisClient();
    if (client && candidate.whatsapp) {
        const cleanPhone = candidate.whatsapp.replace(/\D/g, '');
        // Store in centralized Hash for atomic O(1) lookups across all instances
        await client.hset(KEYS.PHONE_INDEX, cleanPhone, candidate.id).catch(() => { });
    }

    return await saveDistributedItem(KEYS.CANDIDATES_LIST, KEYS.CANDIDATE_PREFIX, candidate, candidate.id);
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

// Ferrari Lookup: O(1) Redis Hash (No scanning required)
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

// Ferrari Deduplication: Atomic SET NX (No race conditions)
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
        console.log('👤 Admin seeded automatically');
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
            console.log('👤 Admin status/role/pin force-updated');
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
    return await getRecentMessages(candidateId, 50); // Fetch last 50 for broad history
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

        console.log(`🔍 [Storage] updateMessageStatus: searching for ${ultraMsgId} in ${messages.length} messages...`);

        const index = messages.findIndex(m => m.ultraMsgId === ultraMsgId || m.id === ultraMsgId);
        if (index !== -1) {
            messages[index] = { ...messages[index], status, ...additionalData };
            await client.lset(key, index, JSON.stringify(messages[index]));
            console.log(`✅ [Storage] updateMessageStatus: Key ${key} Index ${index} updated to ${status}`);
            return true;
        } else {
            console.warn(`⚠️ [Storage] updateMessageStatus: Message ${ultraMsgId} NOT FOUND in ${key}`);
        }
    } catch (e) {
        console.error('❌ [Storage] updateMessageStatus Error:', e);
    }
    return false;
};
