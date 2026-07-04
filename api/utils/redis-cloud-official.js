const REDIS_CLOUD_API_BASE = process.env.REDIS_CLOUD_API_BASE_URL || 'https://api.redislabs.com/v1';

function getCredentials() {
    const apiKey = process.env.REDIS_CLOUD_API_KEY || process.env.REDIS_CLOUD_ACCOUNT_KEY;
    const apiSecret = process.env.REDIS_CLOUD_API_SECRET || process.env.REDIS_CLOUD_SECRET_KEY;
    return { apiKey, apiSecret };
}

function normalizeEndpoint(value) {
    return String(value || '')
        .replace(/^redis:\/\/[^@]*@/i, '')
        .replace(/^rediss:\/\/[^@]*@/i, '')
        .replace(/^redis:\/\//i, '')
        .replace(/^rediss:\/\//i, '')
        .replace(/\/.*$/, '')
        .trim()
        .toLowerCase();
}

function redisUrlEndpoint() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return '';
    try {
        const parsed = new URL(redisUrl);
        return normalizeEndpoint(`${parsed.hostname}:${parsed.port}`);
    } catch {
        return normalizeEndpoint(redisUrl);
    }
}

function extractDatabases(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.databases)) return payload.databases;
    if (Array.isArray(payload?.subscription?.databases)) return payload.subscription.databases;
    return [];
}

async function redisCloudFetch(path) {
    const { apiKey, apiSecret } = getCredentials();
    if (!apiKey || !apiSecret) {
        const error = new Error('Redis Cloud API keys are not configured.');
        error.code = 'missing_config';
        throw error;
    }

    const res = await fetch(`${REDIS_CLOUD_API_BASE}${path}`, {
        headers: {
            accept: 'application/json',
            'x-api-key': apiKey,
            'x-api-secret-key': apiSecret
        }
    });

    if (!res.ok) {
        const error = new Error(`Redis Cloud API returned ${res.status}`);
        error.code = 'redis_cloud_api_error';
        error.status = res.status;
        throw error;
    }

    return res.json();
}

async function listFixedSubscriptions() {
    const payload = await redisCloudFetch('/fixed/subscriptions');
    return Array.isArray(payload?.subscriptions) ? payload.subscriptions : [];
}

async function listFixedDatabases(subscriptionId) {
    const payload = await redisCloudFetch(`/fixed/subscriptions/${subscriptionId}/databases`);
    return extractDatabases(payload);
}

async function getFixedDatabase(subscriptionId, databaseId) {
    return redisCloudFetch(`/fixed/subscriptions/${subscriptionId}/databases/${databaseId}`);
}

function matchesTargetDatabase(database, targetEndpoint, targetDatabaseId) {
    if (targetDatabaseId && String(database?.databaseId) === String(targetDatabaseId)) return true;
    if (!targetEndpoint) return false;

    const publicEndpoint = normalizeEndpoint(database?.publicEndpoint);
    const privateEndpoint = normalizeEndpoint(database?.privateEndpoint);
    return publicEndpoint === targetEndpoint || privateEndpoint === targetEndpoint;
}

function buildOfficialTelemetry(database, subscription = null) {
    const usageBytes = Number(database?.networkMonthlyUsageInByte);
    if (!Number.isFinite(usageBytes) || usageBytes < 0) return null;

    const maximumBandwidthGB = Number(
        subscription?.maximumBandwidthGB
        || subscription?.plan?.maximumBandwidthGB
        || database?.maximumBandwidthGB
        || 200
    );

    return {
        source: 'redis_cloud_official',
        usedBytes: Math.floor(usageBytes),
        limitBytes: Number.isFinite(maximumBandwidthGB) && maximumBandwidthGB > 0
            ? maximumBandwidthGB * 1024 * 1024 * 1024
            : null,
        database: {
            databaseId: database?.databaseId || null,
            name: database?.name || null,
            publicEndpoint: database?.publicEndpoint || null,
            memoryUsedInMb: database?.memoryUsedInMb ?? null,
            status: database?.status || null
        },
        subscription: subscription ? {
            id: subscription.id || null,
            name: subscription.name || null,
            planName: subscription.planName || null,
            planId: subscription.planId || null
        } : null
    };
}

export async function readRedisCloudOfficialUsage() {
    const { apiKey, apiSecret } = getCredentials();
    if (!apiKey || !apiSecret) {
        return { configured: false, available: false, reason: 'missing_config' };
    }

    const targetSubscriptionId = process.env.REDIS_CLOUD_SUBSCRIPTION_ID;
    const targetDatabaseId = process.env.REDIS_CLOUD_DATABASE_ID;
    const targetEndpoint = redisUrlEndpoint();

    try {
        if (targetSubscriptionId && targetDatabaseId) {
            const database = await getFixedDatabase(targetSubscriptionId, targetDatabaseId);
            const official = buildOfficialTelemetry(database, { id: targetSubscriptionId });
            return official
                ? { configured: true, available: true, ...official }
                : { configured: true, available: false, reason: 'missing_network_usage' };
        }

        const subscriptions = targetSubscriptionId
            ? [{ id: targetSubscriptionId }]
            : await listFixedSubscriptions();

        let fallback = null;
        for (const subscription of subscriptions) {
            if (!subscription?.id) continue;
            const databases = await listFixedDatabases(subscription.id);
            if (!fallback && databases.length === 1) fallback = { database: databases[0], subscription };

            const matched = databases.find(database => matchesTargetDatabase(database, targetEndpoint, targetDatabaseId));
            if (matched) {
                const detailed = matched.databaseId
                    ? await getFixedDatabase(subscription.id, matched.databaseId).catch(() => matched)
                    : matched;
                const official = buildOfficialTelemetry(detailed, subscription);
                return official
                    ? { configured: true, available: true, ...official }
                    : { configured: true, available: false, reason: 'missing_network_usage' };
            }
        }

        if (fallback) {
            const detailed = fallback.database?.databaseId
                ? await getFixedDatabase(fallback.subscription.id, fallback.database.databaseId).catch(() => fallback.database)
                : fallback.database;
            const official = buildOfficialTelemetry(detailed, fallback.subscription);
            if (official) return { configured: true, available: true, ...official, matchedBy: 'single_database_fallback' };
        }

        return { configured: true, available: false, reason: 'database_not_found' };
    } catch (error) {
        return {
            configured: true,
            available: false,
            reason: error.code || 'redis_cloud_api_error',
            status: error.status || null
        };
    }
}
