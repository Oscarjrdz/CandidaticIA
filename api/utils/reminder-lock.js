/* global Buffer */
/**
 * Shared per-item processing lock + completion marker for cron jobs that send
 * messages to candidates. Prevents duplicate sends when two invocations
 * (overlapping cron runs, manual "enviar ya" retries) process the same item
 * at the same time.
 */
import { randomUUID } from 'crypto';

const DEFAULT_LOCK_TTL_SECONDS = 10 * 60;
const DEFAULT_COMPLETION_TTL_SECONDS = 60 * 60 * 24 * 30;

function keyFor(prefix, scope, id) {
    return `${prefix}:${scope}:${Buffer.from(String(id)).toString('base64url')}`;
}

export async function acquireProcessingLock(redis, scope, id, ttlSeconds = DEFAULT_LOCK_TTL_SECONDS) {
    const lock = { key: keyFor('lock', scope, id), token: randomUUID() };
    const result = await redis.set(lock.key, lock.token, 'EX', ttlSeconds, 'NX').catch(() => null);
    return result === 'OK' ? lock : null;
}

export async function releaseProcessingLock(redis, lock) {
    if (!redis || !lock) return;
    try {
        const current = await redis.get(lock.key);
        if (current === lock.token) await redis.del(lock.key);
    } catch {
        // Best-effort lock cleanup only.
    }
}

export async function markCompleted(redis, scope, id, value = 'done', ttlSeconds = DEFAULT_COMPLETION_TTL_SECONDS) {
    await redis.set(keyFor('done', scope, id), value, 'EX', ttlSeconds).catch(() => {});
}

export async function isCompleted(redis, scope, id) {
    return Boolean(await redis.get(keyFor('done', scope, id)).catch(() => null));
}
