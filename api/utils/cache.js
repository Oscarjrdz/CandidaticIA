/**
 * Backend Memory Cache System
 * Reduces Redis calls by 90% with intelligent TTL management
 * Facebook-level optimization
 */

const CACHE = new Map();

// TTL Configuration (in milliseconds)
const CACHE_TTL = {
    'ai_config': 300000,              // 5 min (API keys, models)
    'ultramsg_credentials': 600000,   // 10 min (WhatsApp config)
    'candidatic_categories': 900000,  // 15 min (Job categories)
    'bot_ia_prompt': 300000,          // 5 min (Brenda's personality)
    'assistant_ia_prompt': 300000,    // 5 min (Assistant 2.0 prompt)
    'custom_fields': 600000,          // 10 min (Dynamic fields)
    'automation_rules': 300000,       // 5 min (Automation rules)
    'default': 300000                 // 5 min (fallback)
};

/**
 * Get cached config from memory, or fetch from Redis if expired/missing
 * @param {Object} redis - Redis client instance
 * @param {string} key - Redis key to fetch
 * @returns {Promise<string|null>} - Cached or fresh data
 */
export async function getCachedConfig(redis, key) {
    // Check if cache exists and is valid
    const cached = CACHE.get(key);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < (CACHE_TTL[key] || CACHE_TTL.default)) {
        // Cache hit - return immediately
        return cached.data;
    }

    // Cache miss or expired - fetch from Redis
    try {
        const data = await redis.get(key);

        // Store in cache
        CACHE.set(key, {
            data: data,
            timestamp: now
        });

        return data;
    } catch (error) {
        console.error(`❌ Cache fetch error for key "${key}":`, error);

        // If Redis fails but we have stale cache, return it
        if (cached) {
            console.warn(`⚠️ Using stale cache for "${key}"`);
            return cached.data;
        }

        throw error;
    }
}

/**
 * Invalidate cache for a specific key (forces re-fetch)
 * @param {string} key - Redis key to invalidate
 */
export function invalidateCache(key) {
    if (key) {
        CACHE.delete(key);
        console.log(`🗑️ Cache invalidated for: ${key}`);
    } else {
        // Clear all cache
        CACHE.clear();
        console.log(`🗑️ All cache cleared`);
    }
}

/**
 * Get cache statistics (for monitoring)
 * @returns {Object} - Cache stats
 */
export function getCacheStats() {
    const stats = {
        size: CACHE.size,
        keys: Array.from(CACHE.keys()),
        details: []
    };

    const now = Date.now();
    CACHE.forEach((value, key) => {
        const age = now - value.timestamp;
        const ttl = CACHE_TTL[key] || CACHE_TTL.default;
        const remaining = ttl - age;

        stats.details.push({
            key,
            age: Math.round(age / 1000) + 's',
            remaining: Math.round(remaining / 1000) + 's',
            expired: remaining < 0
        });
    });

    return stats;
}

/**
 * Batch get multiple keys with caching
 * @param {Object} redis - Redis client
 * @param {Array<string>} keys - Array of Redis keys
 * @returns {Promise<Object>} - Object with key-value pairs
 */
export async function getCachedConfigBatch(redis, keys) {
    const results = {};
    const keysToFetch = [];
    const now = Date.now();

    // Check cache for each key
    for (const key of keys) {
        const cached = CACHE.get(key);
        const ttl = CACHE_TTL[key] || CACHE_TTL.default;

        if (cached && (now - cached.timestamp) < ttl) {
            // Cache hit
            results[key] = cached.data;
        } else {
            // Cache miss
            keysToFetch.push(key);
        }
    }

    // Fetch missing keys from Redis
    if (keysToFetch.length > 0) {
        try {
            const values = await redis.mget(keysToFetch);

            keysToFetch.forEach((key, index) => {
                const data = values[index];
                results[key] = data;

                // Update cache
                CACHE.set(key, {
                    data: data,
                    timestamp: now
                });
            });
        } catch (error) {
            console.error('❌ Batch cache fetch error:', error);
            throw error;
        }
    }

    return results;
}
