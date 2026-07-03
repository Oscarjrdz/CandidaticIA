const HUMAN_ACTIVE_WINDOW_MS = Number(process.env.HUMAN_ACTIVE_WINDOW_MS || 3 * 60 * 1000);
const HUMAN_WAKE_GRACE_SECONDS = Math.ceil(HUMAN_ACTIVE_WINDOW_MS / 1000) + 60;

function parsePresence(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function markHumanActivity(redis, now = Date.now()) {
    if (!redis) return;
    await redis
        .set('system:human:last_active_at', String(now), 'EX', HUMAN_WAKE_GRACE_SECONDS)
        .catch(() => {});
}

export async function getHumanActivity(redis, now = Date.now()) {
    if (!redis) return { active: false, activeUsers: 0, reason: 'redis_unavailable' };

    await redis.zremrangebyscore('presence:expiry', '-inf', now - 1).catch(() => {});
    const activeKeys = await redis.zrange('presence:expiry', 0, -1).catch(() => []);

    let activeUsers = 0;
    if (activeKeys.length > 0) {
        const rawValues = await redis.hmget('presence:hash', ...activeKeys).catch(() => []);
        activeUsers = rawValues
            .map(parsePresence)
            .filter(user => {
                if (!user?.userId) return false;
                if (user.idle === true) return false;
                const lastSeen = Number(user.lastSeen || 0);
                return Number.isFinite(lastSeen) && (now - lastSeen) <= HUMAN_ACTIVE_WINDOW_MS;
            }).length;
    }

    if (activeUsers > 0) {
        await markHumanActivity(redis, now);
        return { active: true, activeUsers, reason: 'presence_active' };
    }

    const lastActiveRaw = await redis.get('system:human:last_active_at').catch(() => null);
    const lastActive = Number(lastActiveRaw || 0);
    if (Number.isFinite(lastActive) && lastActive > 0 && (now - lastActive) <= HUMAN_ACTIVE_WINDOW_MS) {
        return { active: true, activeUsers: 0, reason: 'recent_activity_grace' };
    }

    return { active: false, activeUsers: 0, reason: 'no_human_active' };
}

export async function shouldRunHumanGatedJob(redis) {
    const activity = await getHumanActivity(redis);
    return {
        allowed: activity.active,
        ...activity
    };
}
